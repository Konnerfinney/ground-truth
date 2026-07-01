import { readFileSync } from "node:fs";
import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import type { QueryData } from "@/engine/query";
import {
  dailyBrief,
  drillDown,
  findUntapped,
  getCell,
  listFlips,
  queryCells,
} from "@/engine/query";
import { GrainNotAvailable } from "@/engine/types";
import type { BriefArtifact, CubeRow, DimEffect, MetaArtifact, SeriesEntry } from "@/engine/types";

/** Integration over the COMMITTED artifacts — the same bytes the demo serves. */

let data: QueryData;

beforeAll(() => {
  const dir = path.join(process.cwd(), "data", "artifacts");
  const read = <T,>(f: string): T => JSON.parse(readFileSync(path.join(dir, f), "utf8")) as T;
  const cube = read<{ rows: CubeRow[] }>("cube.json");
  const series = read<{ entries: SeriesEntry[] }>("series.json");
  data = {
    rows: cube.rows,
    byKey: new Map(cube.rows.map((r) => [r.cell_key, r])),
    brief: read<BriefArtifact>("decisions.json"),
    series: new Map(series.entries.map((s) => [s.cell_key, s])),
    effects: read<{ effects: DimEffect[] }>("dim_effects.json").effects,
    meta: read<MetaArtifact>("meta.json"),
  };
});

describe("queryCells", () => {
  it("resolves a grain by name and by dim list to the same rows", () => {
    const byName = queryCells(data, { grain: "platform-audience" });
    const byDims = queryCells(data, { grain: ["platform", "audience"] });
    expect(byName.rows.map((r) => r.cell_key)).toEqual(byDims.rows.map((r) => r.cell_key));
    expect(byName.applied.grain).toBe("platform-audience");
  });

  it("throws GrainNotAvailable with the full registry for unknown grains", () => {
    try {
      queryCells(data, { grain: ["geo", "device"] });
      expect.unreachable("should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(GrainNotAvailable);
      const err = e as GrainNotAvailable;
      expect(err.available_grains.length).toBeGreaterThan(20);
      expect(err.message).toContain("explain_cell");
    }
  });

  it("applies dim filters and sorts by the requested metric", () => {
    const { rows } = queryCells(data, {
      grain: "campaign",
      filters: { platform: "meta" },
      metric: "spend",
      min_confidence: 0,
      top_n: 500,
    });
    expect(rows.length).toBeGreaterThan(5);
    expect(rows.every((r) => r.dims.platform === "meta")).toBe(true);
    for (let i = 1; i < rows.length; i++) {
      expect(rows[i - 1].spend_c).toBeGreaterThanOrEqual(rows[i].spend_c);
    }
  });

  it("confidence-gates ranking but never hides UNTAPPED rows", () => {
    const gated = queryCells(data, { grain: "story-5", min_confidence: 0.99, top_n: 500 });
    expect(gated.rows.some((r) => r.verdict === "UNTAPPED")).toBe(true);
    expect(gated.rows.every((r) => r.confidence >= 0.99 || r.verdict === "UNTAPPED")).toBe(true);
  });

  it("caps top_n at 500", () => {
    const { applied } = queryCells(data, { grain: "leaf", top_n: 10_000 });
    expect(applied.top_n).toBe(500);
  });
});

describe("getCell / drillDown", () => {
  it("returns the flip cell with series, effects and parent chain", () => {
    const d = getCell(data, data.meta.flip_cell_key)!;
    expect(d.cell.is_flip).toBe(true);
    expect(d.series).not.toBeNull();
    expect(d.effects_for_dims.length).toBeGreaterThanOrEqual(4);
    expect(d.parent_chain.at(-1)?.grain).toBe("global");
  });

  it("null for unknown keys", () => {
    expect(getCell(data, "cnope")).toBeNull();
  });

  it("drillDown returns exactly the children of a platform row", () => {
    const meta = queryCells(data, { grain: "platform", filters: { platform: "meta" }, min_confidence: 0 })
      .rows[0];
    const children = drillDown(data, meta.cell_key);
    expect(children.length).toBeGreaterThan(0);
    expect(children.every((r) => r.parent_key === meta.cell_key)).toBe(true);
  });
});

describe("brief / flips / untapped", () => {
  it("brief carries both headline numbers and the flip card", () => {
    const b = dailyBrief(data);
    expect(b.headline_bleed_c).toBeGreaterThanOrEqual(100_000);
    expect(b.headline_upside_c).toBeGreaterThan(0);
    expect(b.cards.some((c) => c.is_flip)).toBe(true);
  });

  it("listFlips includes the planted flip; findUntapped includes the planted untapped", () => {
    expect(listFlips(data).map((r) => r.cell_key)).toContain(data.meta.flip_cell_key);
    expect(findUntapped(data).map((r) => r.cell_key)).toContain(data.meta.untapped_cell_key);
  });
});
