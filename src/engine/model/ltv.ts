import { fitLogistic, fitRidge, predictLinear, predictLogistic } from "./fit";
import { buildFeatureSpace, encode, type FeatureSpace } from "./features";
import { isBuyerAt, realizedAt, type Subscriber } from "../dgp/world.types";
import { LTV_HORIZON_DAYS, THRESHOLDS, WHALE_ELIGIBLE_AUDIENCES } from "../config";
import type { Rng } from "../rand";

/**
 * The two-part early-LTV model (SPEC §7.3).
 *
 * Plain English: a subscriber's predicted 90-day value is "the chance they
 * ever buy" times "what buyers like them spend", nudged by a calibration
 * factor so predictions average out correctly on cohorts whose outcome we
 * already know — computed separately for whale-eligible audiences, whose
 * spending has a much heavier tail.
 *
 * Units: revenue is modeled in ln(dollars) internally (logs of cents would
 * just shift the intercept, but dollars keep the coefficients human-sized);
 * all public inputs/outputs are integer-ish CENTS (`pred_c`) and CENTS²
 * (`var_c`), matching the repo-wide money convention.
 */

/** Calibration stratum: whale-eligible audiences vs everyone else. */
export type Stratum = "whale" | "rest";

/** Which calibration stratum a subscriber belongs to (by audience). */
export function stratumOf(sub: Subscriber): Stratum {
  return (WHALE_ELIGIBLE_AUDIENCES as readonly string[]).includes(sub.dims.audience)
    ? "whale"
    : "rest";
}

/** Duan-smearing factors for one stratum: S = mean(exp(residual)), S2 = mean(exp(2·residual)). */
export interface StratumCalibration {
  s: number;
  s2: number;
  n_buyers: number;
}

export interface LtvModel {
  /** Shared column layout (dims + z-scored behaviors), fitted on TRAIN subs. */
  space: FeatureSpace;
  /** Part (a): logistic weights for P(buy within 90d). */
  w_conv: Float64Array;
  /** Part (b): ridge weights on ln(90d revenue in dollars), buyers only. */
  w_value: Float64Array;
  /** Stratified smearing factors, fitted on TRAINING buyers only. */
  smear: Record<Stratum, StratumCalibration>;
  /**
   * Blunt per-stratum post-calibration: Σ realized / Σ raw-prediction over the
   * TRAINING subscribers. The lognormal fit is misspecified for the
   * tripwire-to-whale revenue mixture, so smearing alone over-predicts; this
   * factor makes predictions "average out correctly on cohorts whose outcome
   * we already know" — the whole trick, stated plainly (and in the drawer).
   */
  postcal: Record<Stratum, number>;
  /** Mature subscribers held out of training — the out-of-sample bench. */
  holdout: Subscriber[];
  n_train: number;
  n_train_buyers: number;
}

/** ln(90d revenue in dollars), floored at 1¢ so fully-refunded buyers stay finite. */
function lnRevenueDollars(sub: Subscriber): number {
  return Math.log(Math.max(realizedAt(sub, LTV_HORIZON_DAYS), 1) / 100);
}

/**
 * Train the two-part model on mature subscribers (age ≥ 90 days) — for them,
 * realized revenue at snapshot IS the true 90-day LTV by construction, so we
 * never need the truth sidecar. A `holdout_frac` slice is held out (via the
 * provided rng) for the out-of-sample calibration report (SPEC §7.6.9).
 *
 * Plain English: "learn from the subscribers old enough that their 90-day
 * story is fully told; keep one in five of them hidden from the model so we
 * can grade it honestly afterwards."
 */
export function trainLtvModel(subs: readonly Subscriber[], rng: Rng): LtvModel {
  const mature = subs.filter((s) => s.age_days >= LTV_HORIZON_DAYS);
  const train: Subscriber[] = [];
  const holdout: Subscriber[] = [];
  for (const sub of mature) {
    (rng.bernoulli(THRESHOLDS.holdout_frac) ? holdout : train).push(sub);
  }
  if (train.length === 0) {
    throw new Error("trainLtvModel: no mature subscribers (age_days ≥ 90) to train on");
  }

  // Feature space + z-scaling are fitted on TRAINING subs only, so held-out
  // subscribers are measured against a yardstick they never influenced.
  const space = buildFeatureSpace(train, { behaviors: true });
  const rows = train.map((s) => encode(s, space));
  const buyFlags = train.map((s) => (isBuyerAt(s, LTV_HORIZON_DAYS) ? 1 : 0));

  // Part (a): "chance they ever buy."
  const w_conv = fitLogistic(rows, buyFlags, space.d, THRESHOLDS.logistic_lambda);

  // Part (b): "what buyers like them spend" — ridge on ln(dollars), buyers only.
  const buyerRows: typeof rows = [];
  const buyerY: number[] = [];
  const buyerSubs: Subscriber[] = [];
  for (let i = 0; i < train.length; i++) {
    if (buyFlags[i] === 1) {
      buyerRows.push(rows[i]);
      buyerY.push(lnRevenueDollars(train[i]));
      buyerSubs.push(train[i]);
    }
  }
  const w_value =
    buyerRows.length > 0
      ? fitRidge(buyerRows, buyerY, space.d, THRESHOLDS.ridge_lambda, 0)
      : new Float64Array(space.d);

  // Stratified Duan smearing: exp() of a fitted log-model underestimates the
  // mean, so we multiply by the average of exp(residual) over TRAINING buyers
  // — separately for whale-eligible audiences (heavier tail ⇒ bigger factor).
  const acc: Record<Stratum, { s: number; s2: number; n: number }> = {
    whale: { s: 0, s2: 0, n: 0 },
    rest: { s: 0, s2: 0, n: 0 },
  };
  let pooledS = 0;
  let pooledS2 = 0;
  for (let i = 0; i < buyerSubs.length; i++) {
    const resid = buyerY[i] - predictLinear(buyerRows[i], w_value);
    const e1 = Math.exp(resid);
    const e2 = Math.exp(2 * resid);
    const g = stratumOf(buyerSubs[i]);
    acc[g].s += e1;
    acc[g].s2 += e2;
    acc[g].n += 1;
    pooledS += e1;
    pooledS2 += e2;
  }
  const nBuyers = buyerSubs.length;
  const smearFor = (g: Stratum): StratumCalibration => {
    if (acc[g].n > 0) return { s: acc[g].s / acc[g].n, s2: acc[g].s2 / acc[g].n, n_buyers: acc[g].n };
    // Empty stratum: fall back to the pooled factor (or the do-nothing 1).
    if (nBuyers > 0) return { s: pooledS / nBuyers, s2: pooledS2 / nBuyers, n_buyers: 0 };
    return { s: 1, s2: 1, n_buyers: 0 };
  };

  const model: LtvModel = {
    space,
    w_conv,
    w_value,
    smear: { whale: smearFor("whale"), rest: smearFor("rest") },
    postcal: { whale: 1, rest: 1 },
    holdout,
    n_train: train.length,
    n_train_buyers: nBuyers,
  };

  // Post-calibration on the TRAINING population (predictions vs realized).
  const agg: Record<Stratum, { pred: number; real: number }> = {
    whale: { pred: 0, real: 0 },
    rest: { pred: 0, real: 0 },
  };
  for (const sub of train) {
    const g = stratumOf(sub);
    agg[g].pred += predictLtv(sub, model).pred_c;
    agg[g].real += realizedAt(sub, LTV_HORIZON_DAYS);
  }
  for (const g of ["whale", "rest"] as const) {
    model.postcal[g] = agg[g].pred > 0 ? Math.min(10, Math.max(0.1, agg[g].real / agg[g].pred)) : 1;
  }
  return model;
}

/**
 * Predict one subscriber's 90-day LTV (cents) and its per-subscriber
 * predictive variance (cents²), per the pinned SPEC §7.3 formulas:
 *
 *   pred = p̂ · exp(Xβ̂) · S_g        ("chance they buy × what buyers spend")
 *   m₁ = exp(Xβ̂)·S_g,  m₂ = exp(2Xβ̂)·S₂g
 *   var = p̂·m₂ − (p̂·m₁)²            (floored at 0)
 *
 * Plain English: the variance is "how far a single subscriber's actual value
 * typically lands from our best guess" — it feeds the cell-level uncertainty
 * range, it is never shown per-subscriber.
 */
export function predictLtv(sub: Subscriber, model: LtvModel): { pred_c: number; var_c: number } {
  const row = encode(sub, model.space);
  const p = predictLogistic(row, model.w_conv);
  // Defensive clamp: real predictions live in ln($) ∈ [−5, 11]; the clamp
  // only guards exp() overflow under pathological inputs.
  const xb = Math.min(20, Math.max(-20, predictLinear(row, model.w_value)));
  const g = stratumOf(sub);
  const { s, s2 } = model.smear[g];
  const f = model.postcal[g];
  const m1_dollars = Math.exp(xb) * s * f;
  const m2_dollars2 = Math.exp(2 * xb) * s2 * f * f;
  const pred_dollars = p * m1_dollars;
  const var_dollars2 = Math.max(0, p * m2_dollars2 - pred_dollars * pred_dollars);
  return { pred_c: pred_dollars * 100, var_c: var_dollars2 * 100 * 100 };
}

/**
 * Out-of-sample calibration report (SPEC §7.6.9): Σpredicted / Σrealized on
 * held-out mature subscribers — overall, per stratum, and as a decile table
 * for the README chart. A ratio of 1.0 means predictions average out exactly
 * right; the validate gate wants [0.9, 1.1].
 *
 * Strata with zero realized revenue are omitted from `by_stratum` (a ratio
 * against $0 is meaningless, and NaN/Infinity must never reach an artifact).
 */
export function calibrationReport(
  model: LtvModel,
  heldOutSubs: readonly Subscriber[],
): {
  overall: number;
  by_stratum: Record<string, number>;
  deciles: { predicted_mean_c: number; realized_mean_c: number }[];
} {
  const mature = heldOutSubs.filter((s) => s.age_days >= LTV_HORIZON_DAYS);
  const scored = mature.map((sub) => ({
    pred_c: predictLtv(sub, model).pred_c,
    realized_c: realizedAt(sub, LTV_HORIZON_DAYS),
    stratum: stratumOf(sub),
  }));

  const ratioOf = (rows: typeof scored): number => {
    let pred = 0;
    let real = 0;
    for (const r of rows) {
      pred += r.pred_c;
      real += r.realized_c;
    }
    return real > 0 ? pred / real : 0;
  };

  const by_stratum: Record<string, number> = {};
  for (const g of ["whale", "rest"] as const) {
    const rows = scored.filter((r) => r.stratum === g);
    if (rows.some((r) => r.realized_c > 0)) by_stratum[g] = ratioOf(rows);
  }

  // Decile table: sort by prediction, cut into 10 equal slices, report the
  // mean predicted vs mean realized value of each slice ("do the subscribers
  // we score highest actually turn out to be worth the most?").
  const sorted = [...scored].sort((a, b) => a.pred_c - b.pred_c);
  const deciles: { predicted_mean_c: number; realized_mean_c: number }[] = [];
  for (let dec = 0; dec < 10; dec++) {
    const lo = Math.floor((dec * sorted.length) / 10);
    const hi = Math.floor(((dec + 1) * sorted.length) / 10);
    if (hi <= lo) continue; // fewer than 10 subs — skip empty slices
    let pred = 0;
    let real = 0;
    for (let i = lo; i < hi; i++) {
      pred += sorted[i].pred_c;
      real += sorted[i].realized_c;
    }
    deciles.push({ predicted_mean_c: pred / (hi - lo), realized_mean_c: real / (hi - lo) });
  }

  return { overall: ratioOf(scored), by_stratum, deciles };
}

/**
 * Deliberately huge per-subscriber variance for the naive fallback
 * (a $200 standard deviation, in cents²) so downstream shrinkage and CIs
 * treat naive predictions as weak evidence.
 */
export const NAIVE_VAR_C2 = 20_000 ** 2;

/**
 * The M1 stopgap predictor named in SPEC §14: straight-line extrapolation of
 * what a subscriber has already produced, `pred = realized / max(maturity, 0.25)`.
 *
 * Plain English: "if they've lived 45 of 90 days and produced $10, guess $20"
 * — schema-identical to the real model so the pipeline runs before the model
 * lands, with a variance so wide nobody should trust it much.
 */
export function naivePredictor(sub: Subscriber): { pred_c: number; var_c: number } {
  const maturity = Math.min(sub.age_days, LTV_HORIZON_DAYS) / LTV_HORIZON_DAYS;
  const pred_c = realizedAt(sub, sub.age_days) / Math.max(maturity, 0.25);
  return { pred_c, var_c: NAIVE_VAR_C2 };
}
