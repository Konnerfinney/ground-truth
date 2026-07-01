import { COHORT_WEEKS, MACRO_SHOCK_WEEKS, PLATFORM_WINDOW_DAYS, WHALE_CAP_C, WHALE_ELIGIBLE_AUDIENCES } from "../config";
import { Rng, sigmoid } from "../rand";
import { buildCampaigns, buildSpend } from "./spend";
import { OFFER_FE_PRICE_C, OFFER_SMS_BIAS, TUNING, buildTruth, effectsFor } from "./truth";
import type { RevEvent, Subscriber, TruthEffects, World } from "./world.types";

/**
 * World assembly (SPEC §7.2): spend → subscribers → 90-day revenue streams →
 * the platform's flattering 7-day view. Everything downstream (model, cube,
 * verdicts) reads only the World; the truth sidecar never leaves the DGP.
 */

interface SubGenContext {
  rng: Rng;
  truth: TruthEffects;
  weekIndex: Record<string, number>;
}

/** Age at snapshot: W08 subs are 119–125 days old, W25 subs are 0–6. */
function ageDaysFor(weekIdx: number, r: Rng): number {
  return 7 * (COHORT_WEEKS.length - 1 - weekIdx) + r.int(0, 6);
}

function generateSubscriber(
  id: number,
  dims: Subscriber["dims"],
  ctx: SubGenContext,
  r: Rng,
): Subscriber {
  const eff = effectsFor(dims, ctx.truth);

  // Macro-shock weeks pump the front-end punch of fear-family creatives.
  let feconv = eff.feconv;
  if (MACRO_SHOCK_WEEKS.includes(dims.cohort_week) && TUNING.shock_creatives.includes(dims.creative)) {
    feconv *= TUNING.shock_feconv_mult;
  }
  const logFe = Math.log(feconv);

  // Latent quality drives both early behaviors and back-end value (§3.4).
  const z = r.normal(Math.log(eff.ltv), TUNING.z_sigma);

  const opens_7d = r.poisson(TUNING.opens_lambda0 * Math.exp(TUNING.opens_z_coef * z));
  const clicks_7d = r.binomial(opens_7d, sigmoid(TUNING.clicks_z_coef * z));
  const sms_optin = r.bernoulli(sigmoid(TUNING.sms_z_coef * z + (OFFER_SMS_BIAS[dims.offer] ?? -1)));
  const first_purchase = r.bernoulli(
    sigmoid(TUNING.fp_z_coef * z + TUNING.fp_feconv_coef * logFe + TUNING.fp_intercept),
  );

  const events: RevEvent[] = [];
  let purchased_c = 0; // gross impulse purchases (refund target)
  let lastImpulseDay = 0;
  let tookOto = false;

  if (first_purchase) {
    const feAmount = OFFER_FE_PRICE_C[dims.offer] ?? 9_00;
    const feDay = r.int(0, 3);
    events.push({ day: feDay, type: "fe_sale", amount_c: feAmount });
    purchased_c += feAmount;
    lastImpulseDay = feDay;

    // ★ The flip mechanic: impulse buyers grab an immediate $99 OTO where the
    // front-end punch is high; they refund hard and never renew.
    tookOto = r.bernoulli(sigmoid(TUNING.oto_intercept + TUNING.oto_feconv_coef * logFe));
    if (tookOto) {
      const otoDay = r.int(0, 2);
      events.push({ day: otoDay, type: "oto", amount_c: TUNING.oto_amount_c });
      purchased_c += TUNING.oto_amount_c;
      lastImpulseDay = Math.max(lastImpulseDay, otoDay);
    }
  }

  // Considered core purchase d3–30 (email nurture — independent of the door).
  const pCore =
    sigmoid(TUNING.core_intercept + TUNING.core_z_coef * z) * (tookOto ? TUNING.core_after_oto_mult : 1);
  let boughtCore = false;
  if (r.bernoulli(pCore)) {
    boughtCore = true;
    const amount = Math.round(
      TUNING.core_base_amount_c *
        Math.exp(TUNING.core_amount_z_coef * z) *
        r.lognormal(0, TUNING.core_amount_sigma),
    );
    events.push({ day: r.int(3, 30), type: "core_sale", amount_c: amount });
  }

  // Monthly renewals — a survival chain only SUBSCRIBERS WHO BOUGHT enter,
  // and one OTO buyers essentially never do.
  if (first_purchase || boughtCore) {
    const pRenew =
      sigmoid(TUNING.renew_intercept + TUNING.renew_z_coef * z) * (tookOto ? TUNING.renew_oto_mult : 1);
    for (let m = 1; m <= 3; m++) {
      if (!r.bernoulli(pRenew)) break;
      const amount = Math.round(TUNING.renew_base_amount_c * Math.exp(TUNING.renew_amount_z_coef * z));
      events.push({ day: Math.min(90, 30 * m), type: "renewal", amount_c: amount });
    }
  }

  // Sparse affiliate commissions d5–90.
  const pAff = Math.min(TUNING.affiliate_max_p, TUNING.affiliate_base_p * Math.exp(TUNING.affiliate_z_coef * z));
  if (r.bernoulli(pAff)) {
    const amount = Math.min(
      TUNING.affiliate_max_c,
      Math.max(TUNING.affiliate_min_c, Math.round(r.lognormal(TUNING.affiliate_log_amount_mu, TUNING.affiliate_log_amount_sigma))),
    );
    events.push({ day: r.int(5, 90), type: "affiliate", amount_c: amount });
  }

  // Managed-money whales d20–90 — whale-eligible audiences only, winsorized.
  if ((WHALE_ELIGIBLE_AUDIENCES as readonly string[]).includes(dims.audience)) {
    const pWhale = Math.min(TUNING.whale_max_p, TUNING.whale_base_p * Math.exp(TUNING.whale_z_coef * z));
    if (r.bernoulli(pWhale)) {
      const amount = Math.min(WHALE_CAP_C, Math.round(r.pareto(TUNING.whale_pareto_xm_c, TUNING.whale_pareto_alpha)));
      events.push({ day: r.int(20, 90), type: "managed_money", amount_c: amount });
    }
  }

  // Refunds d3–30: impulse purchases get clawed back. Platforms never see this.
  if (purchased_c > 0) {
    const pRefund = Math.min(
      TUNING.refund_max_p,
      TUNING.refund_base_p * eff.refund * (tookOto ? TUNING.refund_oto_boost : 1),
    );
    if (r.bernoulli(pRefund)) {
      events.push({ day: Math.max(lastImpulseDay + 1, r.int(3, 30)), type: "refund", amount_c: -purchased_c });
    }
  }

  return {
    id,
    dims,
    cohort_week: dims.cohort_week,
    age_days: ageDaysFor(ctx.weekIndex[dims.cohort_week], r),
    z,
    opens_7d,
    clicks_7d,
    sms_optin,
    first_purchase,
    events,
  };
}

export function generateWorld(seed: number): World {
  const rng = new Rng(seed);

  const campaigns = buildCampaigns(rng.split("campaigns"));
  const truth = buildTruth(Object.fromEntries(campaigns.map((c) => [c.id, c.propensity])));
  const { rows, overAttribution } = buildSpend(campaigns, truth, rng.split("spend"));

  const weekIndex: Record<string, number> = Object.fromEntries(COHORT_WEEKS.map((w, i) => [w, i]));
  const ctx: SubGenContext = { rng, truth, weekIndex };

  const subs: Subscriber[] = [];
  const subRng = rng.split("subs");
  let id = 0;
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const r = subRng.split(`row:${i}`);
    let windowGross_c = 0;
    for (let k = 0; k < row.optins; k++) {
      const sub = generateSubscriber(id++, row.dims, ctx, r);
      subs.push(sub);
      for (const e of sub.events) {
        // ★ Platform view: GROSS purchases inside the 7-day window; refunds
        // (negative) are invisible to the pixel by construction.
        if (e.amount_c > 0 && e.day <= PLATFORM_WINDOW_DAYS) windowGross_c += e.amount_c;
      }
    }
    row.plat_conv_value_c = Math.round(windowGross_c * overAttribution[i]);
  }

  return { spend: rows, subs, truth };
}
