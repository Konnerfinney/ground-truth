import type { SparseRow } from "./linalg";
import type { Subscriber } from "../dgp/world.types";
import { DIM_NAMES, type DimName } from "../dims";

/**
 * Shared one-hot feature encoding for the model layer (SPEC §7.3).
 *
 * Plain English: every subscriber becomes a sparse row of 0/1 flags — one
 * flag per acquisition trait observed in the training data (platform=meta,
 * creative=hype-10x, …) — plus, when requested, four standardized "how did
 * they behave in their first week" numbers. `cohort_week` is deliberately
 * NOT a feature: future cohorts would always be unseen levels, so the model
 * could never score fresh subscribers.
 */

/** Dims that are legal model features — everything except cohort_week. */
export const MODEL_DIMS: readonly DimName[] = DIM_NAMES.filter((d) => d !== "cohort_week");

/** The four early-behavior signals (first 7 days) the LTV model consumes. */
export const BEHAVIOR_NAMES = ["opens_7d", "clicks_7d", "sms_optin", "first_purchase"] as const;
export type BehaviorName = (typeof BEHAVIOR_NAMES)[number];

/** Numeric value of one behavior on one subscriber (booleans become 0/1). */
export function behaviorValue(sub: Subscriber, name: BehaviorName): number {
  switch (name) {
    case "opens_7d":
      return sub.opens_7d;
    case "clicks_7d":
      return sub.clicks_7d;
    case "sms_optin":
      return sub.sms_optin ? 1 : 0;
    case "first_purchase":
      return sub.first_purchase ? 1 : 0;
  }
}

/**
 * A frozen column layout: which (dim, level) pairs and behaviors map to which
 * column index, plus the z-scaling statistics fitted on the training
 * subscribers. Column 0 is always the intercept.
 */
export interface FeatureSpace {
  /** Total number of columns (intercept + one-hots + behaviors). */
  d: number;
  /** `"dim=level"` → column index, for every level observed at build time. */
  dimCols: ReadonlyMap<string, number>;
  /** Behavior name → column index; null when the space excludes behaviors. */
  behaviorCols: Readonly<Record<BehaviorName, number>> | null;
  /** Training means for z-scoring behaviors (null without behaviors). */
  behaviorMean: Readonly<Record<BehaviorName, number>> | null;
  /** Training standard deviations (floored so we never divide by ~0). */
  behaviorSd: Readonly<Record<BehaviorName, number>> | null;
}

/**
 * Enumerate every (dim, level) observed in `subs` (excluding cohort_week) and
 * assign column indices; optionally append the four behavior columns with
 * z-scaling fitted on these same subs.
 *
 * Plain English: "make a checklist of every trait we saw during training, in
 * a fixed order, and remember the average behavior so we can measure future
 * subscribers against the same yardstick."
 */
export function buildFeatureSpace(
  subs: readonly Subscriber[],
  opts: { behaviors: boolean },
): FeatureSpace {
  const dimCols = new Map<string, number>();
  let next = 1; // col 0 = intercept
  for (const sub of subs) {
    for (const dim of MODEL_DIMS) {
      const key = `${dim}=${sub.dims[dim]}`;
      if (!dimCols.has(key)) dimCols.set(key, next++);
    }
  }

  if (!opts.behaviors) {
    return { d: next, dimCols, behaviorCols: null, behaviorMean: null, behaviorSd: null };
  }

  const behaviorCols = {} as Record<BehaviorName, number>;
  const behaviorMean = {} as Record<BehaviorName, number>;
  const behaviorSd = {} as Record<BehaviorName, number>;
  for (const name of BEHAVIOR_NAMES) {
    behaviorCols[name] = next++;
    let sum = 0;
    for (const sub of subs) sum += behaviorValue(sub, name);
    const mean = subs.length > 0 ? sum / subs.length : 0;
    let ss = 0;
    for (const sub of subs) ss += (behaviorValue(sub, name) - mean) ** 2;
    const sd = subs.length > 0 ? Math.sqrt(ss / subs.length) : 0;
    behaviorMean[name] = mean;
    // Floor: a constant behavior column z-scores to all-zeros (harmless)
    // instead of dividing by zero.
    behaviorSd[name] = sd > 1e-9 ? sd : 1;
  }
  return { d: next, dimCols, behaviorCols, behaviorMean, behaviorSd };
}

/**
 * Encode one subscriber as a sparse row under a fitted space.
 *
 * Plain English: "tick the trait boxes this subscriber matches and write
 * down their standardized week-one behavior." A level never seen during
 * training simply has no box to tick — its column is skipped, which is the
 * same as giving it a coefficient of zero (the safe 'we know nothing'
 * default at predict time).
 */
export function encode(sub: Subscriber, space: FeatureSpace): SparseRow {
  const idx: number[] = [0];
  const val: number[] = [1]; // intercept
  for (const dim of MODEL_DIMS) {
    const col = space.dimCols.get(`${dim}=${sub.dims[dim]}`);
    if (col !== undefined) {
      idx.push(col);
      val.push(1);
    }
  }
  if (space.behaviorCols && space.behaviorMean && space.behaviorSd) {
    for (const name of BEHAVIOR_NAMES) {
      idx.push(space.behaviorCols[name]);
      val.push((behaviorValue(sub, name) - space.behaviorMean[name]) / space.behaviorSd[name]);
    }
  }
  return { idx, val };
}
