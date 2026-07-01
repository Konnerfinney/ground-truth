import { THRESHOLDS } from "../config";

/**
 * Empirical-Bayes shrinkage of a cell's LTV-per-dollar toward its hierarchy
 * parent (SPEC §7.3) — pure per-row math; `cube.ts` drives the top-down pass
 * (parents are always shrunk before their children).
 *
 * Plain English: "a thin cell borrows from its parent until it has earned
 * trust — k (=30) is how many subscribers it takes to mostly stand alone."
 *
 * Units: `ltv_raw`/`ltv_shrunk` are LTV per dollar of spend (unitless
 * ratios); variances are on that same unitless scale.
 */

export interface ShrinkInput {
  /** The cell's own blended LTV per dollar (blended_rev_c / spend_c). */
  ltv_raw: number;
  /** Subscribers observed in the cell. */
  n_subs: number;
  /** Sampling variance of ltv_raw (from `varRawOf`); unitless. */
  var_raw: number;
  /** The already-shrunk parent row, or null for the global root. */
  parent: { ltv_shrunk: number; var_post: number } | null;
}

export interface ShrinkResult {
  /** Posterior mean: the "true LTV:CAC" the UI shows. */
  ltv_shrunk: number;
  /** w = k/(k+n) — the UI's "% borrowed from parent". */
  shrink_weight: number;
  /** Posterior variance, floored at `var_prior_floor`. */
  var_post: number;
  /** 80% uncertainty range: ltv_shrunk ± z80·√var_post. */
  ci_low: number;
  ci_high: number;
}

/**
 * Shrink one cell toward its parent.
 *
 * Step by step, in plain English:
 * 1. `w = k/(k+n)` — how much to borrow. With no subscribers, borrow
 *    everything (w=1); with n=k subscribers, borrow half; with thousands,
 *    borrow almost nothing.
 * 2. The estimate is the borrow-weighted blend of the parent's (already
 *    shrunk) value and the cell's own raw value.
 * 3. The uncertainty blends the same way, but weights are squared because
 *    variances add on the squared scale: `var_post = (1−w)²·var_raw + w²·parent.var_post`.
 * 4. A small floor (`var_prior_floor`) keeps us from ever claiming
 *    near-certainty — even a huge cell gets a minimum-width range.
 * 5. The 80% range is the estimate ± 1.2816 standard deviations: "we'd bet
 *    4-to-1 the truth is inside this band."
 *
 * Special rows: the global root has no parent → it keeps its raw value
 * (w = 0) with the floor applied; a zero-subscriber cell adopts its parent's
 * value and variance wholesale (w = 1).
 */
export function shrinkCell(input: ShrinkInput): ShrinkResult {
  const k = THRESHOLDS.k_shrink;
  const floor = THRESHOLDS.var_prior_floor;
  const { ltv_raw, n_subs, var_raw, parent } = input;

  let ltv_shrunk: number;
  let shrink_weight: number;
  let var_post: number;

  if (parent === null) {
    // Global root: nothing to borrow from — own value, floored variance.
    shrink_weight = 0;
    ltv_shrunk = ltv_raw;
    var_post = Math.max(var_raw, floor);
  } else if (n_subs <= 0) {
    // No evidence of its own: adopt the parent wholesale.
    shrink_weight = 1;
    ltv_shrunk = parent.ltv_shrunk;
    var_post = Math.max(parent.var_post, floor);
  } else {
    const w = k / (k + n_subs);
    shrink_weight = w;
    ltv_shrunk = w * parent.ltv_shrunk + (1 - w) * ltv_raw;
    var_post = Math.max((1 - w) ** 2 * var_raw + w ** 2 * parent.var_post, floor);
  }

  const half = THRESHOLDS.z80 * Math.sqrt(var_post);
  return {
    ltv_shrunk,
    shrink_weight,
    var_post,
    ci_low: ltv_shrunk - half,
    ci_high: ltv_shrunk + half,
  };
}

/**
 * Input for `varRawOf`. Provide EITHER `perSubValues_c` (per-subscriber
 * blended 90d values) OR the precomputed moments `{sum_c, sumsq_c2, n}` —
 * cube.ts accumulates moments so it never has to hold per-sub arrays.
 *
 * UNITS — everything is CENTS-based: values in cents, `sumsq_c2` and
 * `mean_pred_var_c2` in cents², `spend_c` in cents. Because `ltv_raw`
 * (LTV per dollar) is a unitless ratio of cents/cents, its variance is
 * unitless too — but ONLY if the numerator values and the spend use the
 * same unit, which is why this function insists on cents throughout.
 */
export interface VarRawInput {
  perSubValues_c?: readonly number[];
  sum_c?: number;
  sumsq_c2?: number;
  n?: number;
  /** Mean cohort maturity in [0,1] (1 = fully observed 90 days). */
  maturity_frac: number;
  /** Mean per-subscriber predictive variance from the model, cents². */
  mean_pred_var_c2: number;
  /** Cell spend in cents (> 0 for every cube row — 0-spend rows don't exist). */
  spend_c: number;
}

/**
 * Sampling variance of a cell's raw LTV-per-dollar (SPEC §7.3, exact):
 *
 *   var_raw = n · (s²_x + (1 − maturity)² · v̄_pred) / spend_c²
 *
 * with `s²_x` the per-subscriber sample variance of blended values
 * (defined as 0 when n ≤ 1 — one subscriber tells you nothing about spread)
 * and `v̄_pred` the mean per-subscriber predictive variance, discounted by
 * how much of the cohort's 90 days is still unobserved.
 *
 * Plain English: "how much would this cell's LTV-per-dollar wobble if we
 * re-ran the same spend? More subscribers with wilder individual values ⇒
 * more wobble in the total; more spend ⇒ the same wobble matters less
 * (per dollar); younger cohorts lean on predictions, so the model's own
 * uncertainty is added for the unobserved fraction."
 */
export function varRawOf(input: VarRawInput): number {
  let n: number;
  let s2x: number;
  if (input.perSubValues_c !== undefined) {
    n = input.perSubValues_c.length;
    if (n <= 1) {
      s2x = 0;
    } else {
      let sum = 0;
      for (const v of input.perSubValues_c) sum += v;
      const mean = sum / n;
      let ss = 0;
      for (const v of input.perSubValues_c) ss += (v - mean) ** 2;
      s2x = ss / (n - 1);
    }
  } else if (
    input.sum_c !== undefined &&
    input.sumsq_c2 !== undefined &&
    input.n !== undefined
  ) {
    n = input.n;
    // Sample variance from moments: (Σx² − (Σx)²/n) / (n−1), clamped ≥ 0
    // against floating-point cancellation.
    s2x = n <= 1 ? 0 : Math.max(0, (input.sumsq_c2 - (input.sum_c * input.sum_c) / n) / (n - 1));
  } else {
    throw new Error("varRawOf: provide perSubValues_c or {sum_c, sumsq_c2, n}");
  }

  if (n === 0) return 0; // no subscribers ⇒ no sampling variance (shrink adopts the parent)
  const immature = 1 - input.maturity_frac;
  return (n * (s2x + immature * immature * input.mean_pred_var_c2)) / (input.spend_c * input.spend_c);
}
