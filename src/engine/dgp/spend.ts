import {
  CAC0_C,
  COHORT_WEEKS,
  DIM_VALUES,
  N_ACCOUNTS_PER_PLATFORM,
  N_CAMPAIGNS,
  OVER_ATTRIBUTION_RANGE,
  TARGET_WEEKLY_SPEND_C,
  WHALE_ELIGIBLE_AUDIENCES,
  ZIPF_ALPHA,
} from "../config";
import { Rng, zipfWeights } from "../rand";
import { TUNING, effectsFor } from "./truth";
import type { FullDims, SpendCellWeek, TruthEffects } from "./world.types";

/**
 * Cell instantiation + the spend process (SPEC §7.2.2).
 *
 * Each campaign gets a platform, account and offer; runs 1–3 audiences ×
 * 1–3 creatives × 1–2 platform-appropriate placements; and each live
 * combo-week spreads its budget over a SAMPLED set of (geo, device) atoms —
 * never the full 12×3 cross — so sparsity emerges instead of being assigned.
 * `n_subs ~ Poisson(spend / cac)` makes subscriber counts endogenous.
 */

export interface Campaign {
  id: string;
  platform: string;
  ad_account: string;
  offer: string;
  audiences: string[];
  creatives: string[];
  placements: string[];
  propensity: number; // normalized Zipf share of weekly budget
  flipCarrier: boolean;
  untappedCarrier: boolean;
}

const PLATFORM_PLACEMENTS: Record<string, string[]> = {
  meta: ["fb-feed", "reels"],
  google: ["yt-instream", "search", "newsletter-cross-promo"],
  taboola: ["native-widget", "newsletter-cross-promo"],
  tiktok: ["reels"],
};

// Sampling weights aligned with DIM_VALUES order.
const AUDIENCE_WEIGHTS = [0.15, 0.12, 0.12, 0.14, 0.09, 0.12, 0.14, 0.12];
const CREATIVE_WEIGHTS = [0.11, 0.12, 0.13, 0.12, 0.08, 0.1, 0.13, 0.11, 0.1];
const GEO_WEIGHTS = [0.13, 0.08, 0.12, 0.12, 0.1, 0.08, 0.07, 0.07, 0.07, 0.06, 0.05, 0.05];
const DEVICE_WEIGHTS: Record<string, [number, number, number]> = {
  // [desktop, mobile, tablet] — DIM_VALUES.device order
  meta: [0.27, 0.62, 0.11],
  google: [0.48, 0.41, 0.11],
  taboola: [0.44, 0.4, 0.16],
  tiktok: [0.1, 0.84, 0.06],
};

/** Placement-conditional device tilt (reels skews hard mobile, etc.). */
const PLACEMENT_DEVICE_BOOST: Record<string, [number, number, number]> = {
  reels: [1, 2.2, 1],
  search: [1.8, 1, 1],
  "newsletter-cross-promo": [2.2, 1, 1],
  "yt-instream": [1.25, 1, 1],
};

/** Mild platform tilt on geo mix (older money on google/taboola). */
const PLATFORM_GEO_BOOST: Record<string, Partial<Record<string, number>>> = {
  google: { FL: 1.35, AZ: 1.3 },
  taboola: { FL: 1.35, AZ: 1.3 },
  meta: { CA: 1.2, NY: 1.15 },
  tiktok: { CA: 1.2, NY: 1.15 },
};

function sampleDistinct(rng: Rng, values: readonly string[], weights: readonly number[], n: number): string[] {
  const w = weights.slice();
  const out: string[] = [];
  const take = Math.min(n, values.length);
  for (let i = 0; i < take; i++) {
    const idx = rng.categorical(w);
    out.push(values[idx]);
    w[idx] = 0;
  }
  return out;
}

export function buildCampaigns(rng: Rng): Campaign[] {
  const platforms = Object.keys(N_ACCOUNTS_PER_PLATFORM) as (keyof typeof N_ACCOUNTS_PER_PLATFORM)[];
  const platformWeights = platforms.map((p) => N_ACCOUNTS_PER_PLATFORM[p]);
  const zipf = zipfWeights(N_CAMPAIGNS, ZIPF_ALPHA);
  const zipfSum = zipf.reduce((a, b) => a + b, 0);
  const rankOf = rng.shuffle(Array.from({ length: N_CAMPAIGNS }, (_, i) => i));

  const campaigns: Campaign[] = [];
  for (let i = 0; i < N_CAMPAIGNS; i++) {
    const platform = platforms[rng.categorical(platformWeights)];
    const ad_account = `${platform}-a${rng.int(1, N_ACCOUNTS_PER_PLATFORM[platform])}`;
    const propensity = zipf[rankOf[i]] / zipfSum;
    // Head campaigns run broader matrices; the Zipf tail runs one combo.
    const scaled = propensity * N_CAMPAIGNS;
    const isHead = scaled >= 2;
    const isMid = scaled >= 0.6;
    const nAud = isHead ? rng.int(2, 3) : isMid ? rng.int(1, 2) : 1;
    const nCre = isHead ? rng.int(2, 3) : isMid ? rng.int(1, 2) : 1;
    const placementPool = PLATFORM_PLACEMENTS[platform];
    const nPlc = Math.min(isHead ? 2 : isMid ? rng.int(1, 2) : 1, placementPool.length);

    let offer: string;
    let audiences: string[];
    if (rng.bernoulli(TUNING.managed_campaign_p)) {
      // Managed-money offer ONLY on whale-eligible-audience campaigns.
      offer = "managed-money-2k";
      audiences = sampleDistinct(rng, WHALE_ELIGIBLE_AUDIENCES, [0.6, 0.4], Math.min(nAud, 2));
    } else {
      const offerIdx = rng.categorical(TUNING.offer_mix);
      offer = ["tripwire-7", "core-99", "premium-199"][offerIdx];
      audiences = sampleDistinct(rng, DIM_VALUES.audience, AUDIENCE_WEIGHTS, nAud);
    }
    const creatives = sampleDistinct(rng, DIM_VALUES.creative, CREATIVE_WEIGHTS, nCre);
    const placements = sampleDistinct(
      rng,
      placementPool,
      placementPool.map(() => 1),
      nPlc,
    );

    campaigns.push({
      id: `cmp-${String(i + 1).padStart(3, "0")}`,
      platform,
      ad_account,
      offer,
      audiences,
      creatives,
      placements,
      propensity,
      flipCarrier: false,
      untappedCarrier: false,
    });
  }

  // Story-cell isolation guards: only designated carriers may feed the two
  // planted story cells, so the planted mechanisms own their numbers.
  for (const c of campaigns) {
    if (
      c.platform === "meta" &&
      c.audiences.includes("crypto-curious") &&
      c.creatives.includes("hype-10x") &&
      c.placements.includes("reels")
    ) {
      c.creatives = dedupe(c.creatives.map((x) => (x === "hype-10x" ? "ai-boom" : x)), "fear-inflation");
    }
    if (
      c.platform === "google" &&
      c.audiences.includes("retirement") &&
      c.creatives.includes("education") &&
      c.placements.includes("newsletter-cross-promo")
    ) {
      c.creatives = dedupe(c.creatives.map((x) => (x === "education" ? "research" : x)), "income");
    }
  }

  // THE FLIP carriers: several high-propensity meta campaigns (skip the very
  // top one so the flip cell is healthy but doesn't dominate the world).
  const metaByPropensity = campaigns
    .filter((c) => c.platform === "meta")
    .sort((a, b) => b.propensity - a.propensity || a.id.localeCompare(b.id));
  for (const c of metaByPropensity.slice(1, 1 + TUNING.n_flip_carriers)) {
    c.flipCarrier = true;
    c.offer = "tripwire-7"; // the impulse door the OTO mechanic needs
    c.audiences = forceFirst(c.audiences, "crypto-curious", 2);
    c.creatives = forceFirst(c.creatives, "hype-10x", 2);
    c.placements = ["reels", "fb-feed"];
  }

  // THE UNTAPPED carrier: the most propensity-starved google campaign.
  const googleByPropensity = campaigns
    .filter((c) => c.platform === "google" && !c.flipCarrier)
    .sort((a, b) => a.propensity - b.propensity || a.id.localeCompare(b.id));
  const u = googleByPropensity[0];
  u.untappedCarrier = true;
  u.offer = "core-99";
  u.audiences = ["retirement"];
  u.creatives = ["education"];
  u.placements = ["newsletter-cross-promo"];

  return campaigns;
}

function dedupe(xs: string[], fallback: string): string[] {
  const out = [...new Set(xs)];
  if (out.length < xs.length) out.push(fallback);
  return [...new Set(out)];
}

function forceFirst(xs: string[], value: string, keep: number): string[] {
  return [value, ...xs.filter((x) => x !== value)].slice(0, keep);
}

interface Combo {
  audience: string;
  creative: string;
  placement: string;
}

function combosOf(c: Campaign): Combo[] {
  const out: Combo[] = [];
  for (const audience of c.audiences)
    for (const creative of c.creatives)
      for (const placement of c.placements) out.push({ audience, creative, placement });
  return out; // carriers put their story values first ⇒ story combo is out[0]
}

/** (geo, device) atom weights for a platform+placement, DIM order. */
function atomWeights(platform: string, placement: string): number[] {
  const dev = DEVICE_WEIGHTS[platform];
  const boost = PLACEMENT_DEVICE_BOOST[placement] ?? [1, 1, 1];
  const geoBoost = PLATFORM_GEO_BOOST[platform] ?? {};
  const out: number[] = [];
  for (let g = 0; g < DIM_VALUES.geo.length; g++) {
    const gw = GEO_WEIGHTS[g] * (geoBoost[DIM_VALUES.geo[g]] ?? 1);
    for (let d = 0; d < DIM_VALUES.device.length; d++) {
      out.push(gw * dev[d] * boost[d]);
    }
  }
  return out;
}

const atomWeightCache = new Map<string, number[]>();
function atomWeightsCached(platform: string, placement: string): number[] {
  const key = `${platform}|${placement}`;
  let w = atomWeightCache.get(key);
  if (!w) {
    w = atomWeights(platform, placement);
    atomWeightCache.set(key, w);
  }
  return w;
}

export interface SpendBuild {
  rows: SpendCellWeek[];
  /** Per-row platform over-attribution factor (1.1–1.35), used for plat_conv_value. */
  overAttribution: number[];
}

export function buildSpend(campaigns: Campaign[], truth: TruthEffects, rng: Rng): SpendBuild {
  const nWeeks = COHORT_WEEKS.length;

  // Pass 1 — which campaign-weeks are live (Zipf head ≈ always-on, tail flickers).
  const active: boolean[][] = campaigns.map((c) => {
    if (c.untappedCarrier) {
      return COHORT_WEEKS.map((_, w) => w >= TUNING.untapped_week_lo && w <= TUNING.untapped_week_hi);
    }
    const aRng = rng.split(`act:${c.id}`);
    const p = Math.min(1, Math.max(TUNING.activity_floor, c.propensity * TUNING.activity_share_mult));
    return COHORT_WEEKS.map(() => aRng.bernoulli(p));
  });

  const rowRngs = campaigns.map((c) => rng.split(`rows:${c.id}`));
  const rows: SpendCellWeek[] = [];
  const overAttribution: number[] = [];
  const [oaLo, oaHi] = OVER_ATTRIBUTION_RANGE;

  for (let w = 0; w < nWeeks; w++) {
    const week = COHORT_WEEKS[w];
    const curve = TUNING.curve_base + TUNING.curve_ramp * (w / (nWeeks - 1));
    let shareSum = 0;
    for (let i = 0; i < campaigns.length; i++) {
      if (active[i][w] && !campaigns[i].untappedCarrier) shareSum += campaigns[i].propensity;
    }

    for (let i = 0; i < campaigns.length; i++) {
      if (!active[i][w]) continue;
      const c = campaigns[i];
      const r = rowRngs[i];

      let budget: number;
      if (c.untappedCarrier) {
        budget = TUNING.untapped_weekly_c * r.lognormal(0, 0.2);
      } else {
        budget =
          TARGET_WEEKLY_SPEND_C *
          curve *
          (c.propensity / shareSum) *
          r.lognormal(-0.5 * TUNING.budget_sigma ** 2, TUNING.budget_sigma);
        if (budget < TUNING.min_campaign_week_c) continue;
      }

      const combos = combosOf(c);
      const nRun = Math.max(
        1,
        Math.min(Math.round(budget / TUNING.combo_unit_c), combos.length, TUNING.max_combos_week),
      );
      // Carriers pin their story combo first and never rotate past it.
      const start = c.flipCarrier || c.untappedCarrier ? 0 : w % combos.length;

      for (let k = 0; k < nRun; k++) {
        const combo = combos[(start + k) % combos.length];
        const comboBudget =
          (budget / nRun) * r.lognormal(-0.5 * TUNING.combo_sigma ** 2, TUNING.combo_sigma);

        // Sample (geo, device) atoms — 2–6 of them, ∝ platform share vectors.
        let atoms: { geo: string; device: string; frac: number }[];
        if (c.untappedCarrier) {
          atoms = [
            { geo: "FL", device: "desktop", frac: 0.65 },
            { geo: "AZ", device: "desktop", frac: 0.35 },
          ];
        } else {
          const nAtoms = Math.max(
            2,
            Math.min(6, 2 + Math.floor(Math.log2(Math.max(1, comboBudget / TUNING.atom_unit_c)))),
          );
          const weights = atomWeightsCached(c.platform, combo.placement).slice();
          const picked: { idx: number; wt: number }[] = [];
          for (let a = 0; a < nAtoms; a++) {
            const idx = rng ? r.categorical(weights) : 0;
            picked.push({ idx, wt: weights[idx] * r.lognormal(0, TUNING.atom_sigma) });
            weights[idx] = 0;
          }
          const wtSum = picked.reduce((s, p) => s + p.wt, 0);
          atoms = picked.map((p) => ({
            geo: DIM_VALUES.geo[Math.floor(p.idx / DIM_VALUES.device.length)],
            device: DIM_VALUES.device[p.idx % DIM_VALUES.device.length],
            frac: p.wt / wtSum,
          }));
        }

        const fatigue = Math.min(TUNING.fatigue_cap, 1 + TUNING.fatigue_per_week * w);
        for (const atom of atoms) {
          const spend_c = Math.round(comboBudget * atom.frac);
          if (spend_c < TUNING.min_row_spend_c) continue;
          const dims: FullDims = {
            platform: c.platform,
            ad_account: c.ad_account,
            campaign: c.id,
            audience: combo.audience,
            creative: combo.creative,
            placement: combo.placement,
            geo: atom.geo,
            device: atom.device,
            offer: c.offer,
            cohort_week: week,
          };
          const eff = effectsFor(dims, truth);
          const cac =
            CAC0_C * eff.cac * fatigue * TUNING.cac_scale * r.lognormal(0, TUNING.cac_noise_sigma);
          const optins = r.poisson(spend_c / cac);
          rows.push({ dims, week, spend_c, optins, plat_conv_value_c: 0 });
          overAttribution.push(oaLo + (oaHi - oaLo) * r.next());
        }
      }
    }
  }

  return { rows, overAttribution };
}
