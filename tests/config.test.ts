import { describe, expect, it } from "vitest";
import {
  COHORT_WEEKS,
  FLIP_CELL,
  FLIP_CELL_KEY,
  GRAINS,
  GRAIN_BY_NAME,
  UNTAPPED_CELL,
  UNTAPPED_CELL_KEY,
  confidenceOf,
  grainOf,
} from "@/engine/config";
import { DIM_BIT, cellKey, grainMask } from "@/engine/dims";

describe("grain registry closure (SPEC §6.2 — the v1.0 blocker)", () => {
  it("every parent name exists in the registry", () => {
    for (const g of GRAINS) {
      if (g.parent === null) {
        expect(g.name).toBe("global");
        continue;
      }
      expect(GRAIN_BY_NAME.has(g.parent), `${g.name} → ${g.parent}`).toBe(true);
    }
  });

  it("parent dims are a strict subset of child dims (rows can project onto parents)", () => {
    for (const g of GRAINS) {
      if (!g.parent) continue;
      const parent = GRAIN_BY_NAME.get(g.parent)!;
      for (const d of parent.dims) {
        expect(g.dims, `${g.name} missing parent dim ${d}`).toContain(d);
      }
      expect(parent.dims.length).toBeLessThan(g.dims.length);
    }
  });

  it("grain masks are unique (one grain per mask)", () => {
    const masks = GRAINS.map((g) => grainMask(g.dims));
    expect(new Set(masks).size).toBe(GRAINS.length);
  });

  it("walking parents from any grain terminates at global", () => {
    for (const g of GRAINS) {
      let cur = g;
      const seen = new Set<string>([cur.name]);
      while (cur.parent !== null) {
        cur = GRAIN_BY_NAME.get(cur.parent)!;
        expect(seen.has(cur.name), `cycle at ${cur.name}`).toBe(false);
        seen.add(cur.name);
      }
      expect(cur.name).toBe("global");
    }
  });

  it("grainOf resolves by name and by dims, and rejects non-curated grains", () => {
    expect(grainOf("story-5")?.name).toBe("story-5");
    expect(grainOf(["platform", "audience"])?.name).toBe("platform-audience");
    expect(grainOf(["geo", "device"])).toBeNull();
  });
});

describe("story cells (SPEC §2)", () => {
  it("both money-shot cells live exactly at the story-5 grain", () => {
    const story5 = GRAIN_BY_NAME.get("story-5")!;
    const mask = grainMask(story5.dims);
    const flipMask = grainMask(Object.keys(FLIP_CELL) as (keyof typeof DIM_BIT)[]);
    const untappedMask = grainMask(Object.keys(UNTAPPED_CELL) as (keyof typeof DIM_BIT)[]);
    expect(flipMask).toBe(mask);
    expect(untappedMask).toBe(mask);
  });

  it("expected cell keys are stable and distinct", () => {
    expect(FLIP_CELL_KEY).toBe(cellKey(FLIP_CELL));
    expect(UNTAPPED_CELL_KEY).toBe(cellKey(UNTAPPED_CELL));
    expect(FLIP_CELL_KEY).not.toBe(UNTAPPED_CELL_KEY);
  });
});

describe("config sanity", () => {
  it("18 cohort weeks, W08 through W25", () => {
    expect(COHORT_WEEKS).toHaveLength(18);
    expect(COHORT_WEEKS[0]).toBe("2026-W08");
    expect(COHORT_WEEKS[17]).toBe("2026-W25");
  });

  it("confidence is bounded and monotone in its inputs", () => {
    expect(confidenceOf(0, 0, 1)).toBe(0);
    expect(confidenceOf(1000, 1, 0)).toBe(1);
    expect(confidenceOf(30, 0.5, 0.5)).toBeGreaterThan(confidenceOf(10, 0.5, 0.5));
    expect(confidenceOf(30, 0.9, 0.5)).toBeGreaterThan(confidenceOf(30, 0.4, 0.5));
    expect(confidenceOf(30, 0.5, 0.1)).toBeGreaterThan(confidenceOf(30, 0.5, 0.9));
  });
});
