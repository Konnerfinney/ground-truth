import { describe, expect, it } from "vitest";
import {
  DIM_BIT,
  DIM_NAMES,
  cellKey,
  grainMask,
  maskDims,
  parentOf,
  projectDims,
  type Dims,
} from "@/engine/dims";

describe("grain masks", () => {
  it("bit positions are frozen per SPEC §6.1", () => {
    expect(DIM_BIT.platform).toBe(0);
    expect(DIM_BIT.ad_account).toBe(1);
    expect(DIM_BIT.campaign).toBe(2);
    expect(DIM_BIT.audience).toBe(3);
    expect(DIM_BIT.creative).toBe(4);
    expect(DIM_BIT.placement).toBe(5);
    expect(DIM_BIT.geo).toBe(6);
    expect(DIM_BIT.device).toBe(7);
    expect(DIM_BIT.offer).toBe(8);
    expect(DIM_BIT.cohort_week).toBe(9);
  });

  it("round-trips mask ↔ dim list", () => {
    const mask = grainMask(["platform", "audience", "creative"]);
    expect(mask).toBe(0b11001);
    expect(maskDims(mask)).toEqual(["platform", "audience", "creative"]);
    expect(grainMask([])).toBe(0);
  });

  it("projects a full row onto a mask", () => {
    const full = Object.fromEntries(DIM_NAMES.map((d) => [d, `${d}-v`])) as Record<
      (typeof DIM_NAMES)[number],
      string
    >;
    const mask = grainMask(["platform", "geo"]);
    expect(projectDims(full, mask)).toEqual({ platform: "platform-v", geo: "geo-v" });
  });
});

describe("cellKey", () => {
  it("is deterministic and content-addressed", () => {
    const a: Dims = { platform: "meta", audience: "retirement" };
    const b: Dims = { audience: "retirement", platform: "meta" }; // insertion order differs
    expect(cellKey(a)).toBe(cellKey(b));
    expect(cellKey(a)).toMatch(/^c[a-z0-9]+$/);
  });

  it("distinguishes value swaps across dims", () => {
    expect(cellKey({ platform: "meta", geo: "US" })).not.toBe(
      cellKey({ platform: "US", geo: "meta" }),
    );
  });

  it("has no collisions across a realistic cell population", () => {
    const keys = new Set<string>();
    let count = 0;
    for (let c = 0; c < 200; c++) {
      for (let a = 0; a < 8; a++) {
        for (let g = 0; g < 12; g++) {
          keys.add(cellKey({ campaign: `cmp_${c}`, audience: `aud_${a}`, geo: `geo_${g}` }));
          count++;
        }
      }
    }
    expect(keys.size).toBe(count); // 19,200 distinct cells, zero collisions
  });
});

describe("parentOf (EB fallback chain)", () => {
  it("clears the deepest hierarchy bit and keeps facets", () => {
    const leaf: Dims = {
      platform: "meta",
      ad_account: "act_1",
      campaign: "cmp_9",
      audience: "retirement",
      creative: "hype-10x",
      geo: "FL",
    };
    const p1 = parentOf(leaf)!;
    expect(maskDims(p1.mask)).toEqual(["platform", "ad_account", "campaign", "audience", "geo"]);
    expect(p1.dims.geo).toBe("FL");
    expect(p1.dims.creative).toBeUndefined();
  });

  it("walks the full chain to global", () => {
    let cur: Dims = { platform: "meta", ad_account: "act_1", campaign: "cmp_9" };
    const chain: number[] = [];
    for (let step = parentOf(cur); step; step = parentOf(cur)) {
      chain.push(step.mask);
      cur = step.dims;
    }
    expect(chain).toEqual([0b011, 0b001, 0b000]);
  });

  it("facet-only cells fall back to global; global has no parent", () => {
    expect(parentOf({ geo: "FL" })!.mask).toBe(0);
    expect(parentOf({})).toBeNull();
  });
});
