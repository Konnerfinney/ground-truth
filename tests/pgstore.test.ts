import { readFileSync } from "node:fs";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { QueryData } from "@/engine/query";
import { memoryStore, type GroundTruthStore } from "@/engine/store";
import type { BriefArtifact, CubeRow, DimEffect, MetaArtifact, SeriesEntry } from "@/engine/types";
import { GrainNotAvailable } from "@/engine/types";
import { loadIntoPg, pgStore, type Exec } from "@/lib/pg/pgstore";

/**
 * THE PARITY SUITE: the Postgres store and the in-memory store must return
 * row-identical results for the same contract calls. This is the "only the
 * producer changes" production claim as a test, running against real
 * Postgres semantics via PGlite (in-process, no Docker).
 */

let pg: PGlite;
let sqlStore: GroundTruthStore;
let memStore: GroundTruthStore;
let meta: MetaArtifact;

// JSON round-trip: strips undefined vs null representation differences.
const norm = (x: unknown) => JSON.parse(JSON.stringify(x));

beforeAll(async () => {
  const dir = path.join(process.cwd(), "data", "artifacts");
  const read = <T,>(f: string): T => JSON.parse(readFileSync(path.join(dir, f), "utf8")) as T;
  const cube = read<{ rows: CubeRow[] }>("cube.json");
  const series = read<{ entries: SeriesEntry[] }>("series.json");
  meta = read<MetaArtifact>("meta.json");
  const data: QueryData = {
    rows: cube.rows,
    byKey: new Map(cube.rows.map((r) => [r.cell_key, r])),
    brief: read<BriefArtifact>("decisions.json"),
    series: new Map(series.entries.map((s) => [s.cell_key, s])),
    effects: read<{ effects: DimEffect[] }>("dim_effects.json").effects,
    meta,
  };

  pg = new PGlite();
  const exec: Exec = async (sql, params = []) => {
    const res = await pg.query(sql, params as unknown[]);
    return { rows: res.rows as Record<string, unknown>[] };
  };
  await loadIntoPg(exec, data);
  sqlStore = pgStore(exec);
  memStore = memoryStore(data);
}, 60_000);

afterAll(async () => {
  await pg.close();
});

const QUERIES = [
  { grain: "campaign" as const },
  { grain: "story-5" as const, metric: "flip_divergence" as const, top_n: 100 },
  { grain: "platform-audience" as const, filters: { platform: "meta" }, metric: "spend" as const, order: "asc" as const },
  { grain: "leaf" as const, filters: { audience: "crypto-curious", creative: "hype-10x" }, min_confidence: 0, top_n: 500 },
  { grain: "geo" as const, metric: "dollar_impact" as const, min_confidence: 0 },
  { grain: ["platform", "audience"] as const, top_n: 7 },
];

describe("pg ↔ memory parity", () => {
  it("queryCells returns row-identical results across both stores", async () => {
    for (const q of QUERIES) {
      const a = await memStore.queryCells(q as Parameters<GroundTruthStore["queryCells"]>[0]);
      const b = await sqlStore.queryCells(q as Parameters<GroundTruthStore["queryCells"]>[0]);
      expect(norm(b.applied), JSON.stringify(q)).toEqual(norm(a.applied));
      expect(norm(b.rows), JSON.stringify(q)).toEqual(norm(a.rows));
    }
  });

  it("getCell parity on the flip cell (series, effects, children, parent chain)", async () => {
    const a = await memStore.getCell(meta.flip_cell_key);
    const b = await sqlStore.getCell(meta.flip_cell_key);
    expect(norm(b?.cell)).toEqual(norm(a?.cell));
    expect(norm(b?.series)).toEqual(norm(a?.series));
    expect(norm(sortEffects(b!.effects_for_dims))).toEqual(norm(sortEffects(a!.effects_for_dims)));
    expect(norm(b?.children_preview)).toEqual(norm(a?.children_preview));
    expect(norm(b?.parent_chain)).toEqual(norm(a?.parent_chain));
  });

  it("getCell returns null for unknown keys on both stores", async () => {
    expect(await sqlStore.getCell("cnope")).toBeNull();
    expect(await memStore.getCell("cnope")).toBeNull();
  });

  it("dailyBrief parity (headlines + card order)", async () => {
    const a = await memStore.dailyBrief();
    const b = await sqlStore.dailyBrief();
    expect(b.headline_bleed_c).toBe(a.headline_bleed_c);
    expect(b.headline_upside_c).toBe(a.headline_upside_c);
    expect(norm(b.cards)).toEqual(norm(a.cards));
  });

  it("listFlips and findUntapped parity", async () => {
    expect(norm(await sqlStore.listFlips(50_00))).toEqual(norm(await memStore.listFlips(50_00)));
    expect(norm(await sqlStore.findUntapped())).toEqual(norm(await memStore.findUntapped()));
  });

  it("drillDown parity under a platform row", async () => {
    const metaRow = (await memStore.queryCells({ grain: "platform", filters: { platform: "meta" }, min_confidence: 0 })).rows[0];
    expect(norm(await sqlStore.drillDown(metaRow.cell_key))).toEqual(
      norm(await memStore.drillDown(metaRow.cell_key)),
    );
  });

  it("unknown grains throw the same typed error", async () => {
    await expect(sqlStore.queryCells({ grain: ["geo", "device"] })).rejects.toBeInstanceOf(GrainNotAvailable);
    await expect(memStore.queryCells({ grain: ["geo", "device"] })).rejects.toBeInstanceOf(GrainNotAvailable);
  });
});

function sortEffects(e: DimEffect[]): DimEffect[] {
  return [...e].sort((a, b) => `${a.dim}=${a.level}`.localeCompare(`${b.dim}=${b.level}`));
}
