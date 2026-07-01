import { SEED, FLIP_CELL, UNTAPPED_CELL } from "../src/engine/config";
import { generateWorld } from "../src/engine/dgp/world";
import { trueLtv90, type Subscriber, type World } from "../src/engine/dgp/world.types";
import type { Dims } from "../src/engine/dims";

/** DGP tuning diagnostics — prints every SPEC §7.6 band the world must hit. */

function matches(dims: Record<string, string>, cell: Dims): boolean {
  return Object.entries(cell).every(([k, v]) => dims[k as keyof typeof dims] === v);
}

function cellAgg(world: World, cell: Dims) {
  let spend_c = 0;
  let conv_c = 0;
  let optins = 0;
  const subs: Subscriber[] = [];
  for (const r of world.spend) {
    if (!matches(r.dims, cell)) continue;
    spend_c += r.spend_c;
    conv_c += r.plat_conv_value_c;
    optins += r.optins;
  }
  for (const s of world.subs) if (matches(s.dims, cell)) subs.push(s);
  const ltv_c = subs.reduce((a, s) => a + trueLtv90(s), 0);
  return {
    spend: spend_c / 100,
    optins,
    n: subs.length,
    plat_roas: conv_c / Math.max(1, spend_c),
    true_ltv_cac: ltv_c / Math.max(1, spend_c),
  };
}

const t0 = Date.now();
const world = generateWorld(SEED);
const genMs = Date.now() - t0;

const totalSpend = world.spend.reduce((a, r) => a + r.spend_c, 0);
const buyers = world.subs.filter((s) => s.events.some((e) => e.amount_c > 0)).length;

// leaf sparsity at the full 10-dim atom grain
const leafCounts = new Map<string, number>();
for (const s of world.subs) {
  const k = Object.values(s.dims).join("|");
  leafCounts.set(k, (leafCounts.get(k) ?? 0) + 1);
}
// realized full-dim cells include zero-sub spend rows
const spendCells = new Set(world.spend.map((r) => Object.values(r.dims).join("|")));
let thin = 0;
for (const c of spendCells) if ((leafCounts.get(c) ?? 0) <= 5) thin++;

// story-5 grain: starved = spend < 20% of the MEDIAN spend among funded cells
// (n_subs ≥ 30) in the same grain — "less than a fifth of a typical funded cell"
const story5 = new Map<string, { spend_c: number; n: number }>();
const s5key = (d: Record<string, string>) =>
  [d.platform, d.audience, d.creative, d.placement, d.device].join("|");
for (const r of world.spend) {
  const k = s5key(r.dims);
  const cur = story5.get(k) ?? { spend_c: 0, n: 0 };
  cur.spend_c += r.spend_c;
  cur.n += r.optins;
  story5.set(k, cur);
}
const funded = [...story5.values()].filter((c) => c.n >= 30).map((c) => c.spend_c).sort((a, b) => a - b);
const medianFunded = funded[Math.floor(funded.length / 2)] ?? 0;
const starvedThreshold = 0.25 * medianFunded;

const flip = cellAgg(world, FLIP_CELL);
const unt = cellAgg(world, UNTAPPED_CELL);
const untSpend_c = Math.round(unt.spend * 100);

// overall platform ROAS (sanity: portfolio shouldn't scream scam)
const portfolioRoas = world.spend.reduce((a, r) => a + r.plat_conv_value_c, 0) / totalSpend;
const portfolioLtvCac = world.subs.reduce((a, s) => a + trueLtv90(s), 0) / totalSpend;

console.log(
  JSON.stringify(
    {
      gen_ms: genMs,
      subs: world.subs.length,
      spend_rows: world.spend.length,
      full_dim_cells: spendCells.size,
      total_spend_usd: Math.round(totalSpend / 100),
      zero_inflation: +(1 - buyers / world.subs.length).toFixed(3),
      leaf_sparsity_frac_n_le_5: +(thin / spendCells.size).toFixed(3),
      portfolio: { plat_roas: +portfolioRoas.toFixed(2), true_ltv_cac: +portfolioLtvCac.toFixed(2) },
      FLIP: {
        ...flip,
        spend: Math.round(flip.spend),
        plat_roas: +flip.plat_roas.toFixed(2),
        true_ltv_cac: +flip.true_ltv_cac.toFixed(2),
        band_roas: "[1.8, 2.8]",
        band_ltv_cac: "< 1.0",
      },
      UNTAPPED: {
        ...unt,
        spend: Math.round(unt.spend),
        plat_roas: +unt.plat_roas.toFixed(2),
        true_ltv_cac: +unt.true_ltv_cac.toFixed(2),
        starved: untSpend_c < starvedThreshold,
        starved_threshold_usd: Math.round(starvedThreshold / 100),
        median_funded_usd: Math.round(medianFunded / 100),
        band_ltv_cac: "[3.5, 6.5]",
      },
    },
    null,
    1,
  ),
);
