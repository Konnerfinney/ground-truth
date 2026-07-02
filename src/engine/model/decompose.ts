import { fitLogistic, fitRidge } from "./fit";
import { buildFeatureSpace, encode, MODEL_DIMS } from "./features";
import { isBuyerAt, realizedAt, type Subscriber, type TruthEffects } from "../dgp/world.types";
import { LTV_HORIZON_DAYS, THRESHOLDS } from "../config";
import type { DimName, Dims } from "../dims";
import type { DimEffect } from "../types";
import type { Rng } from "../rand";

/**
 * Two-family per-dimension decomposition (SPEC §7.3), mirroring the two-part
 * model: a VALUE family ("what does this trait add to what buyers spend?")
 * and a CONVERSION family ("does this trait make people buy at all?").
 * Keeping the families separate is what lets the flip story read correctly:
 * "hype makes people buy once; it doesn't make them worth anything."
 *
 * Training population: mature subscribers only (age ≥ 90 days — their
 * realized revenue IS their true 90d LTV; the truth sidecar is never read).
 */

const asinh = Math.asinh;
const sinh = Math.sinh;

/**
 * Baselines the imputation composes against, measured on mature subscribers.
 * (The frozen `DimEffect` rows can't carry these, so callers compute them
 * once via `decomposeBaseline` and pass them to `imputeLtvPerDollar`.)
 */
export interface DecomposeBaseline {
  /** Mean 90d realized LTV per mature subscriber, INCLUDING non-buyers (cents). */
  mean_ltv_c: number;
  /** Mean 90d realized revenue per mature BUYER (cents). */
  buyer_mean_rev_c: number;
  n_mature: number;
  n_buyers: number;
}

/** Measure the population baselines the decomposition/imputation hang off. */
export function decomposeBaseline(subs: readonly Subscriber[]): DecomposeBaseline {
  const mature = subs.filter((s) => s.age_days >= LTV_HORIZON_DAYS);
  let total = 0;
  let buyerTotal = 0;
  let nBuyers = 0;
  for (const sub of mature) {
    const rev = realizedAt(sub, LTV_HORIZON_DAYS);
    total += rev;
    if (isBuyerAt(sub, LTV_HORIZON_DAYS)) {
      buyerTotal += rev;
      nBuyers++;
    }
  }
  return {
    mean_ltv_c: mature.length > 0 ? total / mature.length : 0,
    buyer_mean_rev_c: nBuyers > 0 ? buyerTotal / nBuyers : 0,
    n_mature: mature.length,
    n_buyers: nBuyers,
  };
}

/**
 * Fit both effect families and return one row per (dim, level).
 *
 * VALUE family: ridge on asinh(realized dollars) over BUYERS ONLY (asinh
 * behaves like log for real money but stays finite for refunded-to-zero or
 * net-negative buyers), one-hot dims, no behaviors. CONVERSION family:
 * L2-logistic on the buyer flag over ALL mature subs, same one-hot dims.
 *
 * After each fit, coefficients are CENTERED WITHIN THEIR DIM — we subtract
 * the dim's level-mean weighted by level counts — because with an intercept
 * plus exhaustive one-hots only the contrasts are identified. Plain English:
 * each effect is "what this trait adds or subtracts versus the average
 * subscriber, holding the other traits steady", and by construction the
 * population-weighted effects within a dimension cancel to zero.
 *
 * `effect_value_usd` back-transforms the centered asinh-coefficient to
 * approximate dollars at the buyer-mean baseline:
 *   effect_value_usd = sinh(asinh(baseline_$) + coef) − baseline_$
 * i.e. "take an average buyer, apply this trait's effect on the asinh scale,
 * and report how many dollars that moves them." It is exact at the baseline
 * point and approximate elsewhere (documented in the Methodology drawer).
 * `effect_conv` stays on the log-odds scale.
 */
export function decompose(subs: readonly Subscriber[]): DimEffect[] {
  const mature = subs.filter((s) => s.age_days >= LTV_HORIZON_DAYS);
  const space = buildFeatureSpace(mature, { behaviors: false });

  // Level counts over the mature training population (the reported n and
  // the centering weights).
  const levelN = new Map<string, number>();
  for (const sub of mature) {
    for (const dim of MODEL_DIMS) {
      const key = `${dim}=${sub.dims[dim]}`;
      levelN.set(key, (levelN.get(key) ?? 0) + 1);
    }
  }

  // CONVERSION family: FRONT-END purchase over all mature subs. The front
  // door is what the planted m_feconv drives; "did they EVER pay" would mix
  // in back-end value (m_ltv) and blur both families (adversarial finding).
  const rows = mature.map((s) => encode(s, space));
  const convFlags = mature.map((s) => (s.first_purchase ? 1 : 0));
  const wConv =
    mature.length > 0
      ? fitLogistic(rows, convFlags, space.d, THRESHOLDS.logistic_lambda)
      : new Float64Array(space.d);

  // VALUE family: asinh(realized dollars) over 90d BUYERS only — "what does
  // this trait add to what a buyer ends up worth?". Fitting over all subs
  // would mix in the propensity to buy at all, which belongs to the
  // conversion family (the adversarial-review finding this design answers).
  const buyFlags = mature.map((s) => (isBuyerAt(s, LTV_HORIZON_DAYS) ? 1 : 0));
  const buyerRows: typeof rows = [];
  const buyerY: number[] = [];
  let buyerRevTotal = 0;
  for (let i = 0; i < mature.length; i++) {
    if (buyFlags[i] === 1) {
      const rev_c = realizedAt(mature[i], LTV_HORIZON_DAYS);
      buyerRows.push(rows[i]);
      buyerY.push(asinh(rev_c / 100));
      buyerRevTotal += rev_c;
    }
  }
  const wValue =
    buyerRows.length > 0
      ? fitRidge(buyerRows, buyerY, space.d, THRESHOLDS.ridge_lambda, 0)
      : new Float64Array(space.d);
  const baselineDollars = buyerRows.length > 0 ? buyerRevTotal / buyerRows.length / 100 : 0;
  const baselineAsinh = asinh(baselineDollars);

  // Center within dim (weighted by level n) and emit one row per level.
  const effects: DimEffect[] = [];
  for (const dim of MODEL_DIMS) {
    const levels: { level: string; col: number; n: number }[] = [];
    for (const [key, col] of space.dimCols) {
      if (key.startsWith(`${dim}=`)) {
        levels.push({ level: key.slice(dim.length + 1), col, n: levelN.get(key) ?? 0 });
      }
    }
    if (levels.length === 0) continue;
    let totalN = 0;
    let valueMean = 0;
    let convMean = 0;
    for (const l of levels) {
      totalN += l.n;
      valueMean += l.n * wValue[l.col];
      convMean += l.n * wConv[l.col];
    }
    valueMean = totalN > 0 ? valueMean / totalN : 0;
    convMean = totalN > 0 ? convMean / totalN : 0;
    for (const l of levels) {
      const centeredValue = wValue[l.col] - valueMean;
      effects.push({
        dim,
        level: l.level,
        effect_value_usd: sinh(baselineAsinh + centeredValue) - baselineDollars,
        effect_conv: wConv[l.col] - convMean,
        n: l.n,
      });
    }
  }
  return effects;
}

/**
 * UNTAPPED imputation (SPEC §7.3, per-subscriber units, ×/÷ verified):
 *
 *   imputed LTV-per-dollar = composed per-sub LTV ÷ mean(sibling CPL)
 *
 * Composition from the centered effects: start from the population's mean
 * per-subscriber LTV (`baseline.mean_ltv_c`) and, for each pinned dim, apply
 * that level's VALUE effect as a multiplier at the buyer-mean baseline:
 *   multiplier = (buyer_mean_$ + effect_value_usd) / buyer_mean_$
 * i.e. "an average buyer with this trait is worth X% more/less", chained
 * across the pinned dims (clamped to [0.05, 20] so one wild effect can't
 * produce a negative or absurd LTV). A pinned level with no effect row —
 * unseen at training — contributes ×1 (the know-nothing default), and
 * cohort_week is never composed (not a model feature). Conversion effects
 * are deliberately NOT composed: mean_ltv_c already includes the buy rate,
 * and the spec pins value-effects-only.
 *
 * DIRECTION (the v1.0 bug this formula fixes): the sibling CPL is the
 * DENOMINATOR — cheaper subscribers in neighboring cells ⇒ each imputed
 * dollar buys more of them ⇒ HIGHER imputed LTV-per-dollar.
 *
 * Returns null when sibling support is insufficient
 * (< THRESHOLDS.untapped_min_siblings — the caller pre-filters siblings to
 * n ≥ 30) or when the baselines/CPLs are degenerate (≤ 0).
 */
export function imputeLtvPerDollar(
  dims: Dims,
  effects: readonly DimEffect[],
  siblingCpls_c: readonly number[],
  baseline: DecomposeBaseline,
): number | null {
  if (siblingCpls_c.length < THRESHOLDS.untapped_min_siblings) return null;
  let cplSum = 0;
  for (const c of siblingCpls_c) cplSum += c;
  const meanCpl_c = cplSum / siblingCpls_c.length;
  if (!(meanCpl_c > 0)) return null;
  if (!(baseline.mean_ltv_c > 0) || !(baseline.buyer_mean_rev_c > 0)) return null;

  const byKey = new Map<string, DimEffect>();
  for (const e of effects) byKey.set(`${e.dim}=${e.level}`, e);

  const buyerMeanDollars = baseline.buyer_mean_rev_c / 100;
  let composed_c = baseline.mean_ltv_c;
  for (const [dim, level] of Object.entries(dims)) {
    if (dim === "cohort_week" || level === undefined) continue;
    const eff = byKey.get(`${dim}=${level}`);
    if (!eff) continue; // unseen level ⇒ ×1
    const mult = (buyerMeanDollars + eff.effect_value_usd) / buyerMeanDollars;
    // Damped stacking: traits overlap, so each multiplier counts at ~85%
    // when composing a cell nobody has funded (THRESHOLDS.impute_damping).
    composed_c *= Math.pow(Math.min(20, Math.max(0.05, mult)), THRESHOLDS.impute_damping);
  }
  return composed_c / meanCpl_c;
}

/** One planted-vs-recovered comparison row (for recovery.json / README charts). */
export interface RecoveryRow {
  dim: DimName;
  level: string;
  n: number;
  effect_value_usd: number;
  planted_ln_m_ltv: number;
  effect_conv: number;
  planted_ln_m_feconv: number;
}

export interface RecoveryReport {
  /** Pearson corr: recovered value effects vs planted ln(m_ltv). Gate: ≥ 0.8. */
  value_corr: number;
  /** How the value score population was chosen — ships in the artifact. */
  value_scoring_disclosure: string;
  /** Pearson corr: recovered conversion effects vs planted ln(m_feconv). Gate: ≥ 0.8. */
  conv_corr: number;
  /** Corr against a PERMUTED answer key — should be ≈ 0 (gate: |·| ≤ 0.2). */
  negative_control_corr: number;
  table: RecoveryRow[];
}

/** Pearson correlation; 0 when either side has no variance. */
function pearson(xs: readonly number[], ys: readonly number[]): number {
  const n = xs.length;
  if (n < 2) return 0;
  let mx = 0;
  let my = 0;
  for (let i = 0; i < n; i++) {
    mx += xs[i];
    my += ys[i];
  }
  mx /= n;
  my /= n;
  let sxy = 0;
  let sxx = 0;
  let syy = 0;
  for (let i = 0; i < n; i++) {
    sxy += (xs[i] - mx) * (ys[i] - my);
    sxx += (xs[i] - mx) ** 2;
    syy += (ys[i] - my) ** 2;
  }
  if (sxx <= 0 || syy <= 0) return 0;
  return sxy / Math.sqrt(sxx * syy);
}

/**
 * Score the recovered effects against the planted answer key (SPEC §7.6.7).
 *
 * Plain English: "the pipeline is graded against ground truth it never
 * reads — if the per-trait effects we recovered line up with the multipliers
 * we planted, the pipeline works; and to prove the test itself isn't rigged,
 * we also grade against a shuffled answer key, which must score ≈ zero."
 *
 * Population: dim levels with n ≥ THRESHOLDS.recovery_min_n (Zipf-tail
 * campaign levels would mechanically fail otherwise). A level absent from
 * the truth table has planted multiplier 1.0 (ln = 0).
 */
export function recoveryReport(
  effects: readonly DimEffect[],
  truth: TruthEffects,
  rng: Rng,
): RecoveryReport {
  // The recovered effects are centered WITHIN each dim (n-weighted), so the
  // planted ln(m) values must be centered the same way before comparing —
  // otherwise every dim contributes a spurious offset that attenuates the
  // correlation without meaning anything.
  const centered = new Map<string, { ln_ltv: number; ln_conv: number }>();
  for (const dim of new Set(effects.map((e) => e.dim))) {
    if (!truth.m[dim]) continue;
    const dimEffects = effects.filter((e) => e.dim === dim);
    let n = 0;
    let sumLtv = 0;
    let sumConv = 0;
    for (const e of dimEffects) {
      const p = truth.m[dim]?.[e.level];
      sumLtv += e.n * Math.log(p?.m_ltv ?? 1);
      sumConv += e.n * Math.log(p?.m_feconv ?? 1);
      n += e.n;
    }
    const meanLtv = n > 0 ? sumLtv / n : 0;
    const meanConv = n > 0 ? sumConv / n : 0;
    for (const e of dimEffects) {
      const p = truth.m[dim]?.[e.level];
      centered.set(`${dim}=${e.level}`, {
        ln_ltv: Math.log(p?.m_ltv ?? 1) - meanLtv,
        ln_conv: Math.log(p?.m_feconv ?? 1) - meanConv,
      });
    }
  }

  const table: RecoveryRow[] = [];
  for (const e of effects) {
    if (e.n < THRESHOLDS.recovery_min_n) continue;
    // Dims with no planted table (campaign, ad_account) carry no signal to
    // recover — scoring them would measure noise against a column of zeros.
    if (!truth.m[e.dim]) continue;
    const c = centered.get(`${e.dim}=${e.level}`) ?? { ln_ltv: 0, ln_conv: 0 };
    table.push({
      dim: e.dim,
      level: e.level,
      n: e.n,
      effect_value_usd: e.effect_value_usd,
      planted_ln_m_ltv: c.ln_ltv,
      effect_conv: e.effect_conv,
      planted_ln_m_feconv: c.ln_conv,
    });
  }

  // Score each family on its MATERIALLY planted levels only (|ln m| ≥ knob):
  // a level planted ≈ 1.0 is designed to be indistinguishable from neutral.
  // The value family additionally excludes dims whose engineered effect is
  // not their multiplier (offer: ticket prices + whale gating) — see the
  // THRESHOLDS.recovery_value_excluded_dims disclosure.
  const excluded = THRESHOLDS.recovery_value_excluded_dims as readonly string[];
  const valueRows = table.filter(
    (r) => Math.abs(r.planted_ln_m_ltv) >= THRESHOLDS.recovery_min_abs_ln && !excluded.includes(r.dim),
  );
  const convRows = table.filter((r) => Math.abs(r.planted_ln_m_feconv) >= THRESHOLDS.recovery_min_abs_ln);
  const recoveredValue = valueRows.map((r) => r.effect_value_usd);
  const plantedLtv = valueRows.map((r) => r.planted_ln_m_ltv);
  // A single permutation of ~30 points is itself noisy; average the |corr|
  // over 20 permutations so the "no signal" claim is stable across seeds.
  let negControl = 0;
  const N_PERM = 20;
  for (let p = 0; p < N_PERM; p++) {
    negControl += Math.abs(pearson(recoveredValue, rng.shuffle(plantedLtv)));
  }
  negControl /= N_PERM;

  return {
    value_corr: pearson(recoveredValue, plantedLtv),
    value_scoring_disclosure: `Scored over materially planted levels (|ln m| ≥ ${THRESHOLDS.recovery_min_abs_ln}), excluding dims [${excluded.join(", ")}] whose engineered effect includes price structure beyond the planted multiplier. All levels, scored or not, are reported in the table.`,
    conv_corr: pearson(
      convRows.map((r) => r.effect_conv),
      convRows.map((r) => r.planted_ln_m_feconv),
    ),
    negative_control_corr: negControl,
    table,
  };
}
