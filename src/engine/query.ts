import { GRAINS, grainOf } from "./config";
import type { DimName } from "./dims";
import {
  GrainNotAvailable,
  type BriefArtifact,
  type CellQuery,
  type CubeRow,
  type DimEffect,
  type MetaArtifact,
  type SeriesEntry,
} from "./types";

/**
 * The ONE shared query contract (SPEC §7.7): the Next.js UI, the REST API and
 * every MCP tool call these functions — the agent and the dashboard literally
 * cannot tell different stories. Pure functions over a loaded QueryData
 * bundle; no I/O here (src/lib/artifacts.ts wires the filesystem).
 */

export interface QueryData {
  rows: CubeRow[];
  byKey: Map<string, CubeRow>;
  brief: BriefArtifact;
  series: Map<string, SeriesEntry>;
  effects: DimEffect[];
  meta: MetaArtifact;
}

export const QUERY_DEFAULTS = {
  min_confidence: 0.6,
  hurdle: 1.0,
  order: "desc" as const,
  top_n: 50,
  max_top_n: 500,
};

function metricOf(row: CubeRow, metric: CellQuery["metric"]): number {
  switch (metric) {
    case "ltv_per_dollar":
      return row.ltv_shrunk;
    case "ltv_raw":
      return row.ltv_raw;
    case "spend":
      return row.spend_c;
    case "platform_roas":
      return row.platform_roas;
    case "flip_divergence":
      return Math.abs(row.platform_roas - row.ltv_shrunk);
    case "dollar_impact":
      return row.dollar_impact_day_c;
  }
}

export function availableGrains(): { name: string; dims: DimName[] }[] {
  return GRAINS.map((g) => ({ name: g.name, dims: g.dims }));
}

export function queryCells(
  data: QueryData,
  q: Partial<CellQuery> & { grain: CellQuery["grain"] },
): { rows: CubeRow[]; applied: CellQuery } {
  const grain = grainOf(q.grain);
  if (!grain) {
    const requested = typeof q.grain === "string" ? q.grain : q.grain.join("+");
    throw new GrainNotAvailable(requested, availableGrains());
  }
  const applied: CellQuery = {
    grain: grain.name,
    filters: q.filters ?? {},
    metric: q.metric ?? "ltv_per_dollar",
    min_confidence: q.min_confidence ?? QUERY_DEFAULTS.min_confidence,
    hurdle: q.hurdle ?? QUERY_DEFAULTS.hurdle,
    order: q.order ?? QUERY_DEFAULTS.order,
    top_n: Math.min(q.top_n ?? QUERY_DEFAULTS.top_n, QUERY_DEFAULTS.max_top_n),
  };

  const filterEntries = Object.entries(applied.filters).filter(([, v]) => v !== undefined) as [
    DimName,
    string,
  ][];

  const out: CubeRow[] = [];
  for (const row of data.rows) {
    if (row.grain !== grain.name) continue;
    if (row.confidence < applied.min_confidence && row.verdict !== "UNTAPPED") continue;
    let ok = true;
    for (const [d, v] of filterEntries) {
      // A filter on a dim the grain doesn't pin restricts nothing at this
      // grain; a filter on a pinned dim must match.
      if (row.dims[d] !== undefined && row.dims[d] !== v) {
        ok = false;
        break;
      }
    }
    if (ok) out.push(row);
  }

  const sign = applied.order === "desc" ? -1 : 1;
  out.sort(
    (a, b) =>
      sign * (metricOf(a, applied.metric) - metricOf(b, applied.metric)) ||
      a.cell_key.localeCompare(b.cell_key),
  );
  return { rows: out.slice(0, applied.top_n), applied };
}

export interface CellDetail {
  cell: CubeRow;
  series: SeriesEntry | null;
  /** Decomposition effects for exactly the levels this cell pins. */
  effects_for_dims: DimEffect[];
  children_preview: CubeRow[];
  parent_chain: CubeRow[];
}

export function getCell(data: QueryData, key: string): CellDetail | null {
  const cell = data.byKey.get(key);
  if (!cell) return null;
  const pinned = new Set(
    Object.entries(cell.dims).map(([d, v]) => `${d}=${v}`),
  );
  const effects_for_dims = data.effects.filter((e) => pinned.has(`${e.dim}=${e.level}`));
  const children_preview = data.rows
    .filter((r) => r.parent_key === key)
    .sort((a, b) => b.spend_c - a.spend_c || a.cell_key.localeCompare(b.cell_key))
    .slice(0, 10);
  const parent_chain: CubeRow[] = [];
  let cur = cell.parent_key;
  while (cur) {
    const p = data.byKey.get(cur);
    if (!p) break;
    parent_chain.push(p);
    cur = p.parent_key;
  }
  return {
    cell,
    series: data.series.get(key) ?? null,
    effects_for_dims,
    children_preview,
    parent_chain,
  };
}

export function drillDown(data: QueryData, key: string): CubeRow[] {
  return data.rows
    .filter((r) => r.parent_key === key)
    .sort((a, b) => b.spend_c - a.spend_c || a.cell_key.localeCompare(b.cell_key));
}

export function dailyBrief(data: QueryData): BriefArtifact {
  return data.brief;
}

export function listFlips(data: QueryData, minImpact_c = 0): CubeRow[] {
  return data.rows
    .filter((r) => r.is_flip && r.dollar_impact_day_c >= minImpact_c)
    .sort((a, b) => b.dollar_impact_day_c - a.dollar_impact_day_c || a.cell_key.localeCompare(b.cell_key));
}

export function findUntapped(data: QueryData): CubeRow[] {
  return data.rows
    .filter((r) => r.verdict === "UNTAPPED")
    .sort((a, b) => b.dollar_impact_day_c - a.dollar_impact_day_c || a.cell_key.localeCompare(b.cell_key));
}
