import type { DimName } from "../dims";
import type { FullDims, LevelEffects, TruthEffects } from "./world.types";

/**
 * The planted answer key (SPEC §7.2.1, UI-AND-DATA-DESIGN §3.2) plus every
 * DGP tuning constant. Multipliers are DETERMINISTIC — they live in code, not
 * in random draws — so truth_effects.json is exactly reproducible and
 * publishable. A cell's economics = product of multipliers down its dimension
 * path × subscriber noise.
 */

const fx = (m_cac: number, m_feconv: number, m_ltv: number, m_refund: number): LevelEffects => ({
  m_cac,
  m_feconv,
  m_ltv,
  m_refund,
});

/**
 * Per-dim, per-level multipliers. Absent dim or level ⇒ 1.0 (campaign,
 * ad_account and cohort_week carry no planted effect; campaigns act through
 * Zipf propensity, weeks through macro shocks).
 */
export const MULTIPLIERS: TruthEffects["m"] = {
  platform: {
    meta: fx(1.0, 1.1, 1.0, 1.0),
    google: fx(1.05, 0.95, 1.15, 0.9),
    taboola: fx(0.8, 1.05, 0.8, 1.2),
    tiktok: fx(0.75, 1.25, 0.7, 1.3),
  },
  audience: {
    retirement: fx(1.25, 0.9, 1.8, 0.8), // old money: expensive, slow, valuable
    "dividend-income": fx(1.2, 0.95, 1.5, 0.85),
    "options-traders": fx(1.1, 1.1, 1.1, 1.0),
    "crypto-curious": fx(0.7, 1.2, 0.55, 1.3), // cheap, punchy front-end, bad back-end
    "gold-bugs": fx(1.05, 1.0, 1.15, 0.95),
    "inflation-worriers": fx(0.95, 1.05, 1.0, 1.0),
    broad: fx(0.85, 0.95, 0.85, 1.05),
    lookalike: fx(0.9, 1.05, 1.05, 1.0),
  },
  creative: {
    education: fx(1.05, 0.8, 1.4, 0.85), // slow but valuable — UNTAPPED driver
    income: fx(1.0, 1.0, 1.15, 0.95),
    "fear-inflation": fx(0.9, 1.2, 0.9, 1.1),
    "hype-10x": fx(0.75, 1.6, 0.42, 1.8), // THE FLIP driver
    patriotic: fx(0.95, 1.05, 0.9, 1.05),
    contrarian: fx(1.0, 0.95, 1.05, 1.0),
    "ai-boom": fx(0.85, 1.3, 0.75, 1.25),
    "end-of-dollar": fx(0.9, 1.25, 0.85, 1.15),
    research: fx(1.1, 0.85, 1.25, 0.9),
  },
  placement: {
    "fb-feed": fx(1.0, 1.0, 1.0, 1.0),
    reels: fx(0.85, 1.2, 0.8, 1.15),
    "yt-instream": fx(1.05, 0.95, 1.1, 0.95),
    "native-widget": fx(0.8, 1.05, 0.85, 1.1),
    "newsletter-cross-promo": fx(0.9, 0.85, 1.5, 0.8), // high-LTV — UNTAPPED driver
    search: fx(1.15, 1.0, 1.2, 0.9),
  },
  geo: {
    FL: fx(1.05, 1.0, 1.2, 1.0), // retiree-heavy geos amplify back-end value
    AZ: fx(1.0, 1.0, 1.15, 1.0),
    TX: fx(0.95, 1.0, 1.05, 1.0),
    CA: fx(1.1, 1.0, 0.95, 1.0),
    NY: fx(1.1, 1.0, 1.0, 1.0),
    PA: fx(1.0, 1.0, 1.05, 1.0),
    OH: fx(0.9, 1.0, 1.0, 1.0),
    NC: fx(0.95, 1.0, 1.0, 1.0),
    GA: fx(0.95, 1.0, 0.95, 1.0),
    MI: fx(0.9, 1.0, 0.95, 1.0),
    WA: fx(1.05, 1.0, 0.9, 1.0),
    CO: fx(1.0, 1.0, 0.95, 1.0),
  },
  device: {
    desktop: fx(1.1, 0.9, 1.3, 0.85), // older FinPub buyers close high-ticket on desktop
    mobile: fx(0.9, 1.15, 0.85, 1.15),
    tablet: fx(1.0, 0.95, 1.1, 0.95),
  },
  offer: {
    "tripwire-7": fx(0.85, 1.6, 0.9, 1.1), // $7 impulse door — easy front-end yes
    "core-99": fx(1.0, 0.55, 1.0, 1.0),
    "premium-199": fx(1.15, 0.35, 1.25, 0.9),
    "managed-money-2k": fx(1.3, 0.25, 1.6, 0.8), // the whale path
  },
};

/** Front-end sale price by offer (cents). */
export const OFFER_FE_PRICE_C: Record<string, number> = {
  "tripwire-7": 7_00,
  "core-99": 99_00,
  "premium-199": 199_00,
  "managed-money-2k": 49_00, // application/deposit — value arrives via whales
};

/** SMS opt-in bias by offer (logit shift; §3.4 `offer_bias`). */
export const OFFER_SMS_BIAS: Record<string, number> = {
  "tripwire-7": -0.6,
  "core-99": -0.9,
  "premium-199": -1.2,
  "managed-money-2k": -1.4,
};

/**
 * Every tuned constant of the generative process in one place. These were
 * calibrated against the SPEC §7.6 bands (tests/dgp.test.ts enforces them).
 */
export const TUNING = {
  // --- latent quality & early behaviors (§3.4) -----------------------------
  z_sigma: 0.7, // z ~ Normal(log Π m_ltv, 0.7)
  opens_lambda0: 3.0, // opens_7d ~ Poisson(λ0·exp(0.6z))
  opens_z_coef: 0.6,
  clicks_z_coef: 0.8, // clicks_7d ~ Binomial(opens, σ(0.8z))
  sms_z_coef: 1.0, // sms ~ Bernoulli(σ(z + offer_bias))
  // first_purchase ~ Bernoulli(σ(0.5z + β·log Π m_feconv + c))
  fp_z_coef: 0.5,
  fp_feconv_coef: 1.45,
  fp_intercept: -1.3,
  // --- impulse OTO (SPEC §7.2.4 ★ — the flip mechanic) ---------------------
  oto_intercept: -2.944, // σ(-2.944) ≈ 0.05 baseline take-rate
  oto_feconv_coef: 1.39, // → ≈0.25–0.35 in the flip cell
  oto_amount_c: 99_00, // immediate core-99 one-time offer
  // --- core sale d3–30 ------------------------------------------------------
  core_z_coef: 1.1,
  core_intercept: -2.2,
  core_after_oto_mult: 0.3, // impulse buyers rarely buy the real thing
  core_base_amount_c: 79_00,
  core_amount_z_coef: 0.55, // z drives severity, not just frequency
  core_amount_sigma: 0.4,
  // --- monthly renewals (survival; buyers only) -----------------------------
  renew_z_coef: 1.1,
  renew_intercept: 0.4,
  renew_oto_mult: 0.1, // OTO buyers ≈ zero renewals ★
  renew_base_amount_c: 15_00,
  renew_amount_z_coef: 0.45,
  // --- affiliate commissions d5–90 (sparse lognormal) ----------------------
  affiliate_base_p: 0.03,
  affiliate_z_coef: 0.5,
  affiliate_max_p: 0.5,
  affiliate_log_amount_mu: Math.log(18_00),
  affiliate_log_amount_sigma: 0.9,
  affiliate_min_c: 2_00,
  affiliate_max_c: 1_000_00,
  // --- managed-money whales d20–90 (Pareto, winsorized) ---------------------
  whale_base_p: 0.012,
  whale_z_coef: 0.55,
  whale_max_p: 0.1,
  whale_pareto_xm_c: 1_000_00,
  whale_pareto_alpha: 1.6,
  // --- refunds d3–30 (negative; platforms never see them) ------------------
  refund_base_p: 0.07,
  refund_oto_boost: 4.0, // OTO takers refund at m_refund-elevated rates ★
  refund_max_p: 0.95,
  // --- macro shocks ----------------------------------------------------------
  shock_feconv_mult: 1.6,
  shock_creatives: ["fear-inflation", "end-of-dollar"] as readonly string[],
  // --- spend process (§3.3) --------------------------------------------------
  cac_scale: 0.9, // global CAC trim → lands total subs in the 50–65k band
  cac_noise_sigma: 0.12,
  fatigue_per_week: 0.015, // creative fatigue raises CAC over reuse
  fatigue_cap: 1.25,
  curve_base: 0.85, // weekly volume ramps 0.85 → 1.15 across the 18 weeks
  curve_ramp: 0.3,
  budget_sigma: 0.5, // campaign-week lognormal noise
  combo_sigma: 0.25,
  atom_sigma: 0.3,
  combo_unit_c: 150_00, // ≈$150 of weekly budget supports one live combo
  max_combos_week: 10,
  atom_unit_c: 400_00, // atom count grows log2 with combo budget
  min_campaign_week_c: 40_00, // below ≈$40/wk a campaign-week goes dark
  min_row_spend_c: 2_00,
  activity_share_mult: 60, // P(active) = clamp(share·60, floor, 1)
  activity_floor: 0.55,
  managed_campaign_p: 0.1, // share of campaigns on the managed-money offer
  offer_mix: [0.4, 0.35, 0.25], // tripwire / core / premium for the rest
  n_flip_carriers: 4, // meta campaigns forced to carry the flip combo
  untapped_weekly_c: 60_00, // deliberately Zipf-starved (SPEC §2 money shot #2)
  untapped_week_lo: 1, // active W09–W16 → mostly mature cohorts
  untapped_week_hi: 8,
} as const;

/** Multiplier products down a full dimension path. */
export interface PathEffects {
  cac: number;
  feconv: number;
  ltv: number;
  refund: number;
}

export function effectsFor(dims: FullDims, truth: TruthEffects): PathEffects {
  let cac = 1;
  let feconv = 1;
  let ltv = 1;
  let refund = 1;
  for (const dim of Object.keys(truth.m) as DimName[]) {
    const level = truth.m[dim]?.[dims[dim]];
    if (!level) continue;
    cac *= level.m_cac;
    feconv *= level.m_feconv;
    ltv *= level.m_ltv;
    refund *= level.m_refund;
  }
  return { cac, feconv, ltv, refund };
}

export function buildTruth(campaignPropensity: Record<string, number>): TruthEffects {
  return { m: MULTIPLIERS, campaign_propensity: campaignPropensity };
}
