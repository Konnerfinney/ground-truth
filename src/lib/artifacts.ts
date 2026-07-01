import { readFile } from "node:fs/promises";
import path from "node:path";
import type { QueryData } from "@/engine/query";
import type {
  BriefArtifact,
  CubeRow,
  DimEffect,
  MetaArtifact,
  SeriesEntry,
} from "@/engine/types";

/**
 * Artifact loader: fs.readFile from data/artifacts (bundled on Vercel via
 * outputFileTracingIncludes), parsed once, cached at module scope. Never use
 * import.meta.url tricks — process.cwd() is the deploy-safe root.
 */

const DIR = path.join(process.cwd(), "data", "artifacts");

let cached: Promise<QueryData> | null = null;

async function readJson<T>(name: string): Promise<T> {
  return JSON.parse(await readFile(path.join(DIR, name), "utf8")) as T;
}

async function build(): Promise<QueryData> {
  const [cube, decisions, series, effects, meta] = await Promise.all([
    readJson<{ rows: CubeRow[] }>("cube.json"),
    readJson<BriefArtifact>("decisions.json"),
    readJson<{ entries: SeriesEntry[] }>("series.json"),
    readJson<{ effects: DimEffect[] }>("dim_effects.json"),
    readJson<MetaArtifact>("meta.json"),
  ]);
  return {
    rows: cube.rows,
    byKey: new Map(cube.rows.map((r) => [r.cell_key, r])),
    brief: decisions,
    series: new Map(series.entries.map((s) => [s.cell_key, s])),
    effects: effects.effects,
    meta,
  };
}

export function loadArtifacts(): Promise<QueryData> {
  cached ??= build();
  return cached;
}
