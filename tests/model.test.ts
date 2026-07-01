import { describe, expect, it } from "vitest";
import { Rng, sigmoid } from "@/engine/rand";
import type { DimName } from "@/engine/dims";
import type { FullDims, RevEvent, Subscriber, TruthEffects } from "@/engine/dgp/world.types";
import { MODEL_DIMS, buildFeatureSpace, encode } from "@/engine/model/features";
import {
  NAIVE_VAR_C2,
  calibrationReport,
  naivePredictor,
  predictLtv,
  trainLtvModel,
} from "@/engine/model/ltv";
import { shrinkCell, varRawOf } from "@/engine/model/shrink";
import {
  decompose,
  decomposeBaseline,
  imputeLtvPerDollar,
  recoveryReport,
} from "@/engine/model/decompose";
import { THRESHOLDS } from "@/engine/config";
import type { DimEffect } from "@/engine/types";

// ---------------------------------------------------------------------------
// Fixture: a tiny inline DGP with KNOWN planted multipliers. Deliberately
// independent of src/engine/dgp/ internals (only world.types.ts shapes).
// ---------------------------------------------------------------------------

const FIXTURE_LEVELS: Record<DimName, string[]> = {
  platform: ["meta", "google", "taboola", "tiktok"],
  ad_account: ["acct-1"],
  campaign: ["cmp-1", "cmp-2"],
  audience: ["retirement", "dividend-income", "crypto-curious", "broad"],
  creative: ["education", "hype-10x", "income"],
  placement: ["fb-feed", "newsletter-cross-promo"],
  geo: ["FL", "TX", "CA"],
  device: ["desktop", "mobile"],
  offer: ["tripwire-7", "core-99"],
  cohort_week: [], // assigned from age; never a model feature
};

/** Planted back-end value multipliers (the fixture's m_ltv answer key). */
const M_LTV: Partial<Record<DimName, Record<string, number>>> = {
  platform: { meta: 1.0, google: 1.25, taboola: 0.8, tiktok: 1.0 },
  audience: { retirement: 1.7, "dividend-income": 1.35, "crypto-curious": 0.6, broad: 1.0 },
  creative: { education: 1.5, "hype-10x": 0.5, income: 1.0 },
  geo: { FL: 1.15, TX: 1.0, CA: 0.9 },
  device: { desktop: 1.1, mobile: 0.9 },
};

/** Planted front-end conversion multipliers (m_feconv). Note hype-10x and
 * crypto-curious: HIGH conversion but LOW value — the flip mechanic. */
const M_FECONV: Partial<Record<DimName, Record<string, number>>> = {
  platform: { meta: 1.1, google: 0.95, taboola: 1.0, tiktok: 1.0 },
  audience: { retirement: 0.8, "dividend-income": 1.0, "crypto-curious": 1.9, broad: 1.0 },
  creative: { education: 0.75, "hype-10x": 2.0, income: 1.0 },
};

const WHALE_AUDIENCES = new Set(["retirement", "dividend-income"]);

function lnMult(table: Partial<Record<DimName, Record<string, number>>>, dims: FullDims): number {
  let s = 0;
  for (const dim of MODEL_DIMS) s += Math.log(table[dim]?.[dims[dim]] ?? 1);
  return s;
}

interface Fixture {
  subs: Subscriber[];
  /** sub.id → analytic E[LTV] in cents (the fixture's own truth). */
  expectedLtvC: Map<number, number>;
  truth: TruthEffects;
}

function makeFixture(n: number, rng: Rng): Fixture {
  const subs: Subscriber[] = [];
  const expectedLtvC = new Map<number, number>();
  for (let i = 0; i < n; i++) {
    const dims = {} as FullDims;
    for (const dim of MODEL_DIMS) {
      const levels = FIXTURE_LEVELS[dim];
      dims[dim] = levels[rng.int(0, levels.length - 1)];
    }
    const isMature = rng.bernoulli(0.82);
    const age_days = isMature ? rng.int(95, 160) : rng.int(15, 60);
    dims.cohort_week = isMature ? "2026-W10" : "2026-W22";

    const lnV = lnMult(M_LTV, dims);
    const lnC = lnMult(M_FECONV, dims);
    const z = lnV + rng.normal(0, 0.7);

    // Behaviors: noisy children of z (plus first_purchase driven by feconv).
    const opens_7d = Math.max(0, Math.round(4 + 2.2 * z + rng.normal(0, 1.5)));
    const clicks_7d = Math.max(0, Math.round(1.5 + 1.2 * z + rng.normal(0, 1)));
    const sms_optin = rng.bernoulli(sigmoid(-0.4 + 1.5 * z));
    const first_purchase = rng.bernoulli(sigmoid(-1.2 + 1.5 * lnC));

    const pBuy = sigmoid(-0.6 + 1.2 * lnC + 0.35 * z);
    const whale = WHALE_AUDIENCES.has(dims.audience);
    const events: RevEvent[] = [];
    if (rng.bernoulli(pBuy)) {
      let revDollars = Math.exp(3.0 + 0.85 * z + rng.normal(0, 0.5));
      if (whale && rng.bernoulli(0.12)) revDollars *= Math.exp(rng.normal(1.3, 0.4));
      const rev_c = Math.max(1, Math.round(revDollars * 100));
      const fe_c = Math.round(rev_c * 0.6);
      events.push({ day: 1, type: "fe_sale", amount_c: fe_c });
      events.push({ day: 45, type: "core_sale", amount_c: rev_c - fe_c });
      const u = rng.next();
      if (u < 0.01) events.push({ day: 10, type: "refund", amount_c: -rev_c });
      else if (u < 0.05) events.push({ day: 10, type: "refund", amount_c: -Math.round(rev_c * 0.3) });
    }

    // Analytic E[LTV | z, dims] (lognormal mean + whale mixture), pre-refund.
    const whaleFactor = whale ? 0.88 + 0.12 * Math.exp(1.3 + 0.08) : 1;
    expectedLtvC.set(i, pBuy * Math.exp(3.0 + 0.85 * z + 0.125) * whaleFactor * 100);

    subs.push({
      id: i,
      dims,
      cohort_week: dims.cohort_week,
      age_days,
      z,
      opens_7d,
      clicks_7d,
      sms_optin,
      first_purchase,
      events,
    });
  }

  const truth: TruthEffects = { m: {}, campaign_propensity: { "cmp-1": 1, "cmp-2": 1 } };
  for (const dim of MODEL_DIMS) {
    const table: Record<string, { m_cac: number; m_feconv: number; m_ltv: number; m_refund: number }> = {};
    for (const level of FIXTURE_LEVELS[dim]) {
      table[level] = {
        m_cac: 1,
        m_feconv: M_FECONV[dim]?.[level] ?? 1,
        m_ltv: M_LTV[dim]?.[level] ?? 1,
        m_refund: 1,
      };
    }
    truth.m[dim] = table;
  }
  return { subs, expectedLtvC, truth };
}

// Shared across tests (deterministic; built once at import).
const FIXTURE_SEED = 1002;
const FIXTURE = makeFixture(5000, new Rng(FIXTURE_SEED));
const MODEL = trainLtvModel(FIXTURE.subs, new Rng(FIXTURE_SEED).split("holdout"));
const CAL = calibrationReport(MODEL, MODEL.holdout);
const EFFECTS = decompose(FIXTURE.subs);
const BASELINE = decomposeBaseline(FIXTURE.subs);

function effectOf(dim: DimName, level: string): DimEffect {
  const e = EFFECTS.find((x) => x.dim === dim && x.level === level);
  if (!e) throw new Error(`missing effect ${dim}=${level}`);
  return e;
}

function pearsonArr(x: number[], y: number[]): number {
  const n = x.length;
  const mx = x.reduce((a, b) => a + b, 0) / n;
  const my = y.reduce((a, b) => a + b, 0) / n;
  let sxy = 0;
  let sxx = 0;
  let syy = 0;
  for (let i = 0; i < n; i++) {
    sxy += (x[i] - mx) * (y[i] - my);
    sxx += (x[i] - mx) ** 2;
    syy += (y[i] - my) ** 2;
  }
  return sxy / Math.sqrt(sxx * syy);
}

function ranksOf(x: number[]): number[] {
  const order = x.map((v, i) => [v, i] as const).sort((a, b) => a[0] - b[0]);
  const r = new Array<number>(x.length).fill(0);
  let i = 0;
  while (i < order.length) {
    let j = i;
    while (j + 1 < order.length && order[j + 1][0] === order[i][0]) j++;
    const avg = (i + j) / 2 + 1;
    for (let k = i; k <= j; k++) r[order[k][1]] = avg;
    i = j + 1;
  }
  return r;
}

function spearman(x: number[], y: number[]): number {
  return pearsonArr(ranksOf(x), ranksOf(y));
}

const SOME_DIMS: FullDims = {
  platform: "meta",
  ad_account: "acct-1",
  campaign: "cmp-1",
  audience: "broad",
  creative: "income",
  placement: "fb-feed",
  geo: "TX",
  device: "desktop",
  offer: "core-99",
  cohort_week: "2026-W10",
};

function bareSub(age_days: number, events: RevEvent[], dims: Partial<FullDims> = {}): Subscriber {
  return {
    id: 999999,
    dims: { ...SOME_DIMS, ...dims },
    cohort_week: "2026-W10",
    age_days,
    z: 0,
    opens_7d: 2,
    clicks_7d: 1,
    sms_optin: false,
    first_purchase: false,
    events,
  };
}

// ---------------------------------------------------------------------------
// features.ts
// ---------------------------------------------------------------------------

describe("buildFeatureSpace / encode", () => {
  it("puts the intercept at column 0 and excludes cohort_week", () => {
    const space = buildFeatureSpace(FIXTURE.subs.slice(0, 200), { behaviors: false });
    const row = encode(FIXTURE.subs[0], space);
    expect(row.idx[0]).toBe(0);
    expect(row.val[0]).toBe(1);
    for (const key of space.dimCols.keys()) {
      expect(key.startsWith("cohort_week=")).toBe(false);
    }
    expect(Math.min(...space.dimCols.values())).toBe(1); // nothing collides with the intercept
  });

  it("skips unseen levels at predict time (coefficient-0 default)", () => {
    const train = [bareSub(100, [], { platform: "meta" }), bareSub(100, [], { platform: "google" })];
    const space = buildFeatureSpace(train, { behaviors: false });
    const unseen = bareSub(100, [], { platform: "tiktok" });
    const row = encode(unseen, space);
    // intercept + 8 of 9 model dims (platform=tiktok has no column)
    expect(row.idx.length).toBe(1 + MODEL_DIMS.length - 1);
    const platformCols = new Set(
      [...space.dimCols.entries()].filter(([k]) => k.startsWith("platform=")).map(([, c]) => c),
    );
    expect(row.idx.some((c) => platformCols.has(c))).toBe(false);
  });

  it("z-scores behaviors on the provided subs (mean ≈ 0, sd ≈ 1)", () => {
    const train = FIXTURE.subs.slice(0, 1000);
    const space = buildFeatureSpace(train, { behaviors: true });
    expect(space.behaviorCols).not.toBeNull();
    const opensCol = space.behaviorCols!.opens_7d;
    const vals = train.map((s) => {
      const row = encode(s, space);
      return row.val[row.idx.indexOf(opensCol)];
    });
    const mean = vals.reduce((a, b) => a + b, 0) / vals.length;
    const sd = Math.sqrt(vals.reduce((a, b) => a + b * b, 0) / vals.length - mean * mean);
    expect(Math.abs(mean)).toBeLessThan(1e-9);
    expect(sd).toBeCloseTo(1, 6);
  });
});

// ---------------------------------------------------------------------------
// ltv.ts — the two-part model
// ---------------------------------------------------------------------------

describe("trainLtvModel / predictLtv", () => {
  it("holds out roughly holdout_frac of mature subs, trains on the rest", () => {
    const mature = FIXTURE.subs.filter((s) => s.age_days >= 90).length;
    expect(MODEL.n_train + MODEL.holdout.length).toBe(mature);
    const frac = MODEL.holdout.length / mature;
    expect(frac).toBeGreaterThan(THRESHOLDS.holdout_frac - 0.05);
    expect(frac).toBeLessThan(THRESHOLDS.holdout_frac + 0.05);
  });

  it("is calibrated out-of-sample: Σpred/Σrealized ∈ [0.85, 1.15]", () => {
    expect(CAL.overall).toBeGreaterThan(0.85);
    expect(CAL.overall).toBeLessThan(1.15);
  });

  it("is roughly calibrated per stratum out-of-sample", () => {
    expect(CAL.by_stratum.whale).toBeGreaterThan(0.8);
    expect(CAL.by_stratum.whale).toBeLessThan(1.2);
    expect(CAL.by_stratum.rest).toBeGreaterThan(0.8);
    expect(CAL.by_stratum.rest).toBeLessThan(1.2);
  });

  it("rank-correlates with the fixture's true expected LTV (Spearman > 0.3)", () => {
    const preds = MODEL.holdout.map((s) => predictLtv(s, MODEL).pred_c);
    const truth = MODEL.holdout.map((s) => FIXTURE.expectedLtvC.get(s.id)!);
    expect(spearman(preds, truth)).toBeGreaterThan(0.3);
  });

  it("whale stratum smearing factor exceeds rest (heavier tail)", () => {
    expect(MODEL.smear.whale.n_buyers).toBeGreaterThan(50);
    expect(MODEL.smear.rest.n_buyers).toBeGreaterThan(50);
    expect(MODEL.smear.whale.s).toBeGreaterThan(MODEL.smear.rest.s);
  });

  it("decile table rises: high-scored subs realize more than low-scored", () => {
    expect(CAL.deciles.length).toBe(10);
    const first = CAL.deciles[0];
    const last = CAL.deciles[9];
    expect(last.realized_mean_c).toBeGreaterThan(first.realized_mean_c);
    expect(last.predicted_mean_c).toBeGreaterThan(first.predicted_mean_c);
  });

  it("predictions are finite with non-negative variance", () => {
    for (const sub of FIXTURE.subs.slice(0, 200)) {
      const { pred_c, var_c } = predictLtv(sub, MODEL);
      expect(Number.isFinite(pred_c)).toBe(true);
      expect(pred_c).toBeGreaterThanOrEqual(0);
      expect(Number.isFinite(var_c)).toBe(true);
      expect(var_c).toBeGreaterThanOrEqual(0);
    }
  });
});

describe("naivePredictor (M1 stopgap)", () => {
  const events: RevEvent[] = [
    { day: 1, type: "fe_sale", amount_c: 1000 },
    { day: 45, type: "core_sale", amount_c: 500 },
  ];

  it("returns realized LTV for a fully mature sub", () => {
    expect(naivePredictor(bareSub(90, events)).pred_c).toBe(1500);
    expect(naivePredictor(bareSub(160, events)).pred_c).toBe(1500);
  });

  it("extrapolates by maturity for a young sub", () => {
    // age 45 → maturity 0.5 → pred = realized(45) / 0.5
    expect(naivePredictor(bareSub(45, events)).pred_c).toBe(3000);
  });

  it("floors maturity at 0.25 for very young subs", () => {
    // age 9 → maturity 0.1 → floored to 0.25 → pred = 1000 / 0.25
    expect(naivePredictor(bareSub(9, events)).pred_c).toBe(4000);
  });

  it("carries a deliberately huge variance", () => {
    expect(naivePredictor(bareSub(90, events)).var_c).toBe(NAIVE_VAR_C2);
    expect(NAIVE_VAR_C2).toBeGreaterThan(1e8);
  });
});

// ---------------------------------------------------------------------------
// shrink.ts
// ---------------------------------------------------------------------------

describe("shrinkCell", () => {
  const parent = { ltv_shrunk: 1.0, var_post: 0.5 };

  it("n → large: estimate approaches the raw value", () => {
    const r = shrinkCell({ ltv_raw: 2.0, n_subs: 1_000_000, var_raw: 1e-4, parent });
    expect(r.ltv_shrunk).toBeCloseTo(2.0, 3);
    expect(r.shrink_weight).toBeLessThan(1e-4);
  });

  it("n = 0: adopts the parent wholesale", () => {
    const r = shrinkCell({ ltv_raw: 99, n_subs: 0, var_raw: Number.NaN, parent });
    expect(r.ltv_shrunk).toBe(parent.ltv_shrunk);
    expect(r.var_post).toBe(Math.max(parent.var_post, THRESHOLDS.var_prior_floor));
    expect(r.shrink_weight).toBe(1);
    expect(Number.isFinite(r.ci_low)).toBe(true);
    expect(Number.isFinite(r.ci_high)).toBe(true);
  });

  it("n = k: borrows exactly half", () => {
    const r = shrinkCell({ ltv_raw: 2.0, n_subs: THRESHOLDS.k_shrink, var_raw: 0.02, parent });
    expect(r.shrink_weight).toBeCloseTo(0.5, 12);
    expect(r.ltv_shrunk).toBeCloseTo(1.5, 12);
  });

  it("global row (no parent): keeps raw value with floored variance", () => {
    const r = shrinkCell({ ltv_raw: 1.4, n_subs: 60000, var_raw: 1e-6, parent: null });
    expect(r.ltv_shrunk).toBe(1.4);
    expect(r.shrink_weight).toBe(0);
    expect(r.var_post).toBe(THRESHOLDS.var_prior_floor);
  });

  it("CI width shrinks as a cell earns more subscribers (via varRawOf)", () => {
    const widthAt = (n: number): number => {
      // per-sub blended values with fixed spread; spend scales with n
      const values = Array.from({ length: n }, (_, i) => 1000 + (i % 2 === 0 ? -500 : 500));
      const var_raw = varRawOf({
        perSubValues_c: values,
        maturity_frac: 1,
        mean_pred_var_c2: 0,
        spend_c: n * 3000,
      });
      const r = shrinkCell({ ltv_raw: 0.33, n_subs: n, var_raw, parent: { ltv_shrunk: 1, var_post: 0.04 } });
      return r.ci_high - r.ci_low;
    };
    expect(widthAt(250)).toBeLessThan(widthAt(10));
  });

  it("stays finite at n = 1 with var_raw = 0 (floor kicks in)", () => {
    const r = shrinkCell({ ltv_raw: 3.0, n_subs: 1, var_raw: 0, parent });
    expect(Number.isFinite(r.ltv_shrunk)).toBe(true);
    expect(r.var_post).toBeGreaterThanOrEqual(THRESHOLDS.var_prior_floor);
    expect(r.ci_low).toBeLessThan(r.ltv_shrunk);
    expect(r.ci_high).toBeGreaterThan(r.ltv_shrunk);
  });
});

describe("varRawOf", () => {
  it("treats s² as 0 when n ≤ 1", () => {
    const v = varRawOf({
      perSubValues_c: [5000],
      maturity_frac: 0.5,
      mean_pred_var_c2: 40000,
      spend_c: 3000,
    });
    // n=1: var = 1·(0 + 0.25·40000)/3000²
    expect(v).toBeCloseTo((0.25 * 40000) / 9_000_000, 12);
  });

  it("returns 0 for an empty cell", () => {
    expect(varRawOf({ perSubValues_c: [], maturity_frac: 0, mean_pred_var_c2: 1e6, spend_c: 100 })).toBe(0);
  });

  it("moment inputs match per-value inputs", () => {
    const values = [1200, 800, 4500, 60, 2200];
    const sum = values.reduce((a, b) => a + b, 0);
    const sumsq = values.reduce((a, b) => a + b * b, 0);
    const a = varRawOf({ perSubValues_c: values, maturity_frac: 0.7, mean_pred_var_c2: 900, spend_c: 15000 });
    const b = varRawOf({
      sum_c: sum,
      sumsq_c2: sumsq,
      n: values.length,
      maturity_frac: 0.7,
      mean_pred_var_c2: 900,
      spend_c: 15000,
    });
    expect(a).toBeCloseTo(b, 15);
    expect(a).toBeGreaterThan(0);
  });

  it("doubling spend quarters the variance (units sanity)", () => {
    const base = { perSubValues_c: [1000, 2000, 3000], maturity_frac: 0.5, mean_pred_var_c2: 500 };
    const v1 = varRawOf({ ...base, spend_c: 9000 });
    const v2 = varRawOf({ ...base, spend_c: 18000 });
    expect(v1 / v2).toBeCloseTo(4, 10);
  });

  it("fully mature cells carry no prediction-variance term", () => {
    const withPred = varRawOf({
      perSubValues_c: [1000, 2000],
      maturity_frac: 1,
      mean_pred_var_c2: 1e9,
      spend_c: 6000,
    });
    const without = varRawOf({
      perSubValues_c: [1000, 2000],
      maturity_frac: 1,
      mean_pred_var_c2: 0,
      spend_c: 6000,
    });
    expect(withPred).toBe(without);
  });

  it("throws when given neither values nor moments", () => {
    expect(() => varRawOf({ maturity_frac: 1, mean_pred_var_c2: 0, spend_c: 100 })).toThrow(/varRawOf/);
  });
});

// ---------------------------------------------------------------------------
// decompose.ts
// ---------------------------------------------------------------------------

describe("decompose", () => {
  it("recovers the SIGNS of planted value effects", () => {
    expect(effectOf("creative", "education").effect_value_usd).toBeGreaterThan(0); // m_ltv 1.5
    expect(effectOf("creative", "hype-10x").effect_value_usd).toBeLessThan(0); // m_ltv 0.5
    expect(effectOf("audience", "retirement").effect_value_usd).toBeGreaterThan(0); // m_ltv 1.7
    expect(effectOf("audience", "crypto-curious").effect_value_usd).toBeLessThan(0); // m_ltv 0.6
    expect(effectOf("platform", "google").effect_value_usd).toBeGreaterThan(
      effectOf("platform", "taboola").effect_value_usd,
    ); // 1.25 vs 0.8
  });

  it("keeps the two families independent: high-conv/low-value plants recover BOTH", () => {
    // hype-10x: m_feconv 2.0 (buys once) but m_ltv 0.5 (worth little)
    expect(effectOf("creative", "hype-10x").effect_conv).toBeGreaterThan(0);
    expect(effectOf("creative", "hype-10x").effect_value_usd).toBeLessThan(0);
    // crypto-curious: same flip shape at the audience dim
    expect(effectOf("audience", "crypto-curious").effect_conv).toBeGreaterThan(0);
    expect(effectOf("audience", "crypto-curious").effect_value_usd).toBeLessThan(0);
    // education converts WORSE but is worth MORE
    expect(effectOf("creative", "education").effect_conv).toBeLessThan(0);
    expect(effectOf("creative", "education").effect_value_usd).toBeGreaterThan(0);
  });

  it("centers conversion effects to ~0 within each dim (n-weighted)", () => {
    for (const dim of MODEL_DIMS) {
      const rows = EFFECTS.filter((e) => e.dim === dim);
      if (rows.length === 0) continue;
      const totalN = rows.reduce((a, e) => a + e.n, 0);
      const wMean = rows.reduce((a, e) => a + e.n * e.effect_conv, 0) / totalN;
      expect(Math.abs(wMean)).toBeLessThan(1e-9);
    }
  });

  it("value effects center near 0 within dim (approximate: $ scale is nonlinear)", () => {
    const buyerMeanUsd = BASELINE.buyer_mean_rev_c / 100;
    for (const dim of MODEL_DIMS) {
      const rows = EFFECTS.filter((e) => e.dim === dim);
      if (rows.length === 0) continue;
      const totalN = rows.reduce((a, e) => a + e.n, 0);
      const wMean = rows.reduce((a, e) => a + e.n * e.effect_value_usd, 0) / totalN;
      expect(Math.abs(wMean)).toBeLessThan(0.15 * buyerMeanUsd);
    }
  });

  it("reports n over the mature training population", () => {
    const matureN = FIXTURE.subs.filter((s) => s.age_days >= 90).length;
    for (const dim of MODEL_DIMS) {
      const rows = EFFECTS.filter((e) => e.dim === dim);
      if (rows.length === 0) continue;
      expect(rows.reduce((a, e) => a + e.n, 0)).toBe(matureN);
    }
  });
});

describe("imputeLtvPerDollar", () => {
  const effects: DimEffect[] = [
    { dim: "audience", level: "retirement", effect_value_usd: 15, effect_conv: 0.2, n: 500 },
    { dim: "creative", level: "education", effect_value_usd: 10, effect_conv: -0.1, n: 400 },
  ];
  const baseline = { mean_ltv_c: 20_00, buyer_mean_rev_c: 40_00, n_mature: 1000, n_buyers: 500 };
  const dims = { audience: "retirement", creative: "education" } as const;

  it("computes composed LTV ÷ mean sibling CPL", () => {
    // composed = 2000 × (40+15)/40 × (40+10)/40 = 3437.5c; mean CPL = 3000c
    const v = imputeLtvPerDollar(dims, effects, [2500, 3500], baseline);
    expect(v).toBeCloseTo(3437.5 / 3000, 10);
  });

  it("DIRECTION: halving sibling CPL doubles the imputed LTV-per-dollar", () => {
    const v1 = imputeLtvPerDollar(dims, effects, [2500, 3500], baseline)!;
    const v2 = imputeLtvPerDollar(dims, effects, [1250, 1750], baseline)!;
    expect(v2 / v1).toBeCloseTo(2, 10);
  });

  it("returns null on insufficient sibling support", () => {
    expect(imputeLtvPerDollar(dims, effects, [3000], baseline)).toBeNull();
    expect(imputeLtvPerDollar(dims, effects, [], baseline)).toBeNull();
  });

  it("unseen levels contribute ×1 and cohort_week is never composed", () => {
    const v = imputeLtvPerDollar(
      { audience: "never-seen", cohort_week: "2026-W10" },
      effects,
      [2000, 2000],
      baseline,
    );
    expect(v).toBeCloseTo(2000 / 2000, 10); // baseline LTV only
  });

  it("a higher-value path imputes more than a lower-value one (fixture effects)", () => {
    const siblings = [2800, 3200];
    const good = imputeLtvPerDollar(
      { audience: "retirement", creative: "education" },
      EFFECTS,
      siblings,
      BASELINE,
    )!;
    const bad = imputeLtvPerDollar(
      { audience: "crypto-curious", creative: "hype-10x" },
      EFFECTS,
      siblings,
      BASELINE,
    )!;
    expect(good).toBeGreaterThan(bad);
  });
});

describe("recoveryReport", () => {
  const report = recoveryReport(EFFECTS, FIXTURE.truth, new Rng(FIXTURE_SEED).split("negctl"));

  it("value family recovers the planted ln(m_ltv) (corr > 0.7)", () => {
    expect(report.value_corr).toBeGreaterThan(0.7);
  });

  it("conversion family recovers the planted ln(m_feconv) (corr > 0.5)", () => {
    expect(report.conv_corr).toBeGreaterThan(0.5);
  });

  it("negative control (permuted answer key) shows no signal (|corr| < 0.4)", () => {
    expect(Math.abs(report.negative_control_corr)).toBeLessThan(0.4);
  });

  it("only includes levels with n ≥ recovery_min_n", () => {
    expect(report.table.length).toBeGreaterThan(10);
    for (const row of report.table) {
      expect(row.n).toBeGreaterThanOrEqual(THRESHOLDS.recovery_min_n);
    }
  });
});
