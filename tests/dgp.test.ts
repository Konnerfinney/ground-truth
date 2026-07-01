import { beforeAll, describe, expect, it } from "vitest";
import {
  FLIP_CELL,
  PLATFORM_WINDOW_DAYS,
  SEED,
  THRESHOLDS,
  UNTAPPED_CELL,
  WHALE_CAP_C,
  WHALE_ELIGIBLE_AUDIENCES,
} from "@/engine/config";
import type { Dims } from "@/engine/dims";
import { generateWorld } from "@/engine/dgp/world";
import { trueLtv90, type World } from "@/engine/dgp/world.types";

/**
 * The DGP band tests — this suite IS the tuning contract (SPEC §7.6
 * validate:core asserts mirror these on the built artifacts).
 */

let world: World;

beforeAll(() => {
  world = generateWorld(SEED);
});

function matches(dims: Record<string, string>, cell: Dims): boolean {
  return Object.entries(cell).every(([k, v]) => dims[k as keyof typeof dims] === v);
}

function cellAgg(cell: Dims) {
  let spend_c = 0;
  let conv_c = 0;
  let ltv_c = 0;
  let n = 0;
  for (const r of world.spend) {
    if (!matches(r.dims, cell)) continue;
    spend_c += r.spend_c;
    conv_c += r.plat_conv_value_c;
  }
  for (const s of world.subs) {
    if (!matches(s.dims, cell)) continue;
    n++;
    ltv_c += trueLtv90(s);
  }
  return { spend_c, n, plat_roas: conv_c / spend_c, true_ltv_cac: ltv_c / spend_c };
}

describe("volume & sparsity bands", () => {
  it("subscriber count lands in the believable mid-size FinPub band", () => {
    expect(world.subs.length).toBeGreaterThan(50_000);
    expect(world.subs.length).toBeLessThan(75_000);
  });

  it("zero-inflation: 50-72% of subscribers never pay a cent", () => {
    const buyers = world.subs.filter((s) => s.events.some((e) => e.amount_c > 0)).length;
    const zi = 1 - buyers / world.subs.length;
    expect(zi).toBeGreaterThan(0.5);
    expect(zi).toBeLessThan(0.72);
  });

  it("≥60% of realized full-dim cells have ≤5 subscribers (sparsity emerges)", () => {
    const counts = new Map<string, number>();
    for (const s of world.subs) {
      const k = Object.values(s.dims).join("|");
      counts.set(k, (counts.get(k) ?? 0) + 1);
    }
    const cells = new Set(world.spend.map((r) => Object.values(r.dims).join("|")));
    let thin = 0;
    for (const c of cells) if ((counts.get(c) ?? 0) <= 5) thin++;
    expect(thin / cells.size).toBeGreaterThanOrEqual(0.6);
    expect(cells.size).toBeGreaterThan(8_000);
    expect(cells.size).toBeLessThan(18_000);
  });
});

describe("THE FLIP (money shot #1)", () => {
  it("platform calls it a winner (ROAS 1.8-2.8×) while true LTV:CAC < 1", () => {
    const flip = cellAgg(FLIP_CELL);
    expect(flip.plat_roas).toBeGreaterThanOrEqual(1.8);
    expect(flip.plat_roas).toBeLessThanOrEqual(2.8);
    expect(flip.true_ltv_cac).toBeLessThan(1.0);
    expect(flip.true_ltv_cac).toBeGreaterThan(0.15); // a loser, not a void
    expect(flip.n).toBeGreaterThan(300); // healthy: cannot be confidence-forced to WATCH
  });
});

describe("THE UNTAPPED (money shot #2)", () => {
  it("planted high-value but starved below 25% of a typical funded cell", () => {
    const unt = cellAgg(UNTAPPED_CELL);
    // The realized value of a ~4-subscriber cell is whale-lottery noise; the
    // guarantee lives in the PLANTED multiplier product (deterministic) and
    // in validate:core's imputed-value band. Assert the plant, not the roll.
    // google 1.15 × retirement 1.8 × education 1.4 × newsletter 1.5 × desktop 1.3 ≈ 5.65
    let planted = 1;
    for (const [dim, level] of Object.entries(UNTAPPED_CELL)) {
      planted *= world.truth.m[dim as keyof typeof world.truth.m]?.[level as string]?.m_ltv ?? 1;
    }
    expect(planted).toBeGreaterThanOrEqual(4);
    expect(unt.n).toBeGreaterThan(0);

    // starved rule: spend < starved_frac × median spend of funded story-5 cells
    const story5 = new Map<string, { spend_c: number; n: number }>();
    for (const r of world.spend) {
      const k = [r.dims.platform, r.dims.audience, r.dims.creative, r.dims.placement, r.dims.device].join("|");
      const cur = story5.get(k) ?? { spend_c: 0, n: 0 };
      cur.spend_c += r.spend_c;
      cur.n += r.optins;
      story5.set(k, cur);
    }
    const funded = [...story5.values()]
      .filter((c) => c.n >= THRESHOLDS.n_floor)
      .map((c) => c.spend_c)
      .sort((a, b) => a - b);
    const median = funded[Math.floor(funded.length / 2)];
    expect(unt.spend_c).toBeLessThan(THRESHOLDS.starved_frac * median);
  });
});

describe("revenue mechanics", () => {
  it("whales only in whale-eligible audiences, always winsorized at the cap", () => {
    for (const s of world.subs) {
      for (const e of s.events) {
        if (e.type !== "managed_money") continue;
        expect((WHALE_ELIGIBLE_AUDIENCES as readonly string[]).includes(s.dims.audience)).toBe(true);
        expect(e.amount_c).toBeLessThanOrEqual(WHALE_CAP_C);
        expect(e.day).toBeGreaterThanOrEqual(20);
      }
    }
  });

  it("refunds are negative and OTOs only follow a first purchase", () => {
    let otoCount = 0;
    let refundCount = 0;
    for (const s of world.subs) {
      for (const e of s.events) {
        if (e.type === "refund") {
          refundCount++;
          expect(e.amount_c).toBeLessThan(0);
        }
        if (e.type === "oto") {
          otoCount++;
          expect(s.first_purchase).toBe(true);
        }
      }
    }
    expect(otoCount).toBeGreaterThan(500);
    expect(refundCount).toBeGreaterThan(500);
  });

  it("platform window: conv value counts ONLY gross purchases ≤7d, grossed up 1.1-1.35×", () => {
    // reconstruct a material row and bound its over-attribution factor
    const bySpend = [...world.spend].sort((a, b) => b.spend_c - a.spend_c);
    const checked: number[] = [];
    for (const row of bySpend.slice(0, 200)) {
      let gross = 0;
      for (const s of world.subs) {
        if (s.dims !== row.dims) continue; // same object identity: subs generated per row
        for (const e of s.events) {
          if (e.amount_c > 0 && e.day <= PLATFORM_WINDOW_DAYS) gross += e.amount_c;
        }
      }
      if (gross === 0) continue;
      checked.push(row.plat_conv_value_c / gross);
    }
    expect(checked.length).toBeGreaterThan(20);
    for (const f of checked) {
      expect(f).toBeGreaterThanOrEqual(1.1 - 1e-6);
      expect(f).toBeLessThanOrEqual(1.35 + 0.01); // rounding slack
    }
  });

  it("cohorts W08-W12 are fully 90d-mature at snapshot; W25 is 0-6 days old", () => {
    for (const s of world.subs) {
      if (s.cohort_week <= "2026-W12") expect(s.age_days).toBeGreaterThanOrEqual(91);
      if (s.cohort_week === "2026-W25") expect(s.age_days).toBeLessThanOrEqual(6);
    }
  });
});

describe("determinism & performance", () => {
  it("same seed ⇒ identical world (counts, spend, first sub fingerprint)", () => {
    const again = generateWorld(SEED);
    expect(again.subs.length).toBe(world.subs.length);
    expect(again.spend.length).toBe(world.spend.length);
    const spendSum = (w: World) => w.spend.reduce((a, r) => a + r.spend_c, 0);
    expect(spendSum(again)).toBe(spendSum(world));
    expect(JSON.stringify(again.subs[0])).toBe(JSON.stringify(world.subs[0]));
    expect(JSON.stringify(again.subs.at(-1))).toBe(JSON.stringify(world.subs.at(-1)));
  });

  it("generates in well under 30s", () => {
    const t0 = performance.now();
    generateWorld(SEED + 1);
    expect(performance.now() - t0).toBeLessThan(30_000);
  });
});
