import { grainOf } from "@/engine/config";
import type { DimName } from "@/engine/dims";
import { QUERY_DEFAULTS, availableGrains, type CellDetail } from "@/engine/query";
import type { GroundTruthStore } from "@/engine/store";
import type { QueryData } from "@/engine/query";
import {
  GrainNotAvailable,
  type BriefArtifact,
  type CellQuery,
  type CubeRow,
  type MetaArtifact,
} from "@/engine/types";
import { DDL, TABLES } from "./schema";

/**
 * Postgres implementation of the GroundTruthStore — filtering, ranking, and
 * the parent-chain walk pushed into SQL. Driver-agnostic via a tiny Exec
 * closure so the same code runs on PGlite (tests, zero install) and
 * postgres.js (a real DATABASE_URL). Parity with the in-memory store is
 * asserted row-for-row in tests/pgstore.test.ts.
 */

export type Exec = (sql: string, params?: unknown[]) => Promise<{ rows: Record<string, unknown>[] }>;

const METRIC_SQL: Record<CellQuery["metric"], string> = {
  ltv_per_dollar: "ltv_shrunk",
  ltv_raw: "ltv_raw",
  spend: "spend_c",
  platform_roas: "platform_roas",
  flip_divergence: "ABS(platform_roas - ltv_shrunk)",
  dollar_impact: "dollar_impact_day_c",
};

function rowToCube(r: Record<string, unknown>): CubeRow {
  return {
    cell_key: r.cell_key as string,
    grain: r.grain as string,
    grain_mask: Number(r.grain_mask),
    dims: r.dims as CubeRow["dims"],
    parent_key: (r.parent_key as string | null) ?? null,
    n_subs: Number(r.n_subs),
    spend_c: Number(r.spend_c),
    last_week_spend_c: Number(r.last_week_spend_c),
    realized_rev_c: Number(r.realized_rev_c),
    fe_rev_c: Number(r.fe_rev_c),
    be_rev_c: Number(r.be_rev_c),
    pred_ltv_sum_c: Number(r.pred_ltv_sum_c),
    blended_rev_c: Number(r.blended_rev_c),
    maturity_frac: Number(r.maturity_frac),
    cpl_c: Number(r.cpl_c),
    cac_c: Number(r.cac_c),
    ltv_raw: Number(r.ltv_raw),
    ltv_shrunk: Number(r.ltv_shrunk),
    shrink_weight: Number(r.shrink_weight),
    ci_low: Number(r.ci_low),
    ci_high: Number(r.ci_high),
    platform_roas: Number(r.platform_roas),
    confidence: Number(r.confidence),
    payback_day: r.payback_day === null ? null : Number(r.payback_day),
    verdict: r.verdict as CubeRow["verdict"],
    leaning: (r.leaning as CubeRow["leaning"]) ?? null,
    is_flip: Boolean(r.is_flip),
    dollar_impact_day_c: Number(r.dollar_impact_day_c),
    reason: r.reason as string,
  };
}

export function pgStore(exec: Exec): GroundTruthStore {
  const metaOnce = (async () => {
    const { rows } = await exec("SELECT meta FROM snapshot_meta WHERE id = 1");
    return rows[0].meta as MetaArtifact;
  })();

  return {
    async queryCells(q) {
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
      const params: unknown[] = [grain.name, applied.min_confidence];
      // Match the in-memory semantics exactly: a filter on a dim this grain
      // does not pin restricts nothing; a pinned dim must match.
      let filterSql = "";
      for (const [d, v] of Object.entries(applied.filters)) {
        if (v === undefined) continue;
        params.push(d, v);
        filterSql += ` AND (dims->>$${params.length - 1} IS NULL OR dims->>$${params.length - 1} = $${params.length})`;
      }
      const dir = applied.order === "desc" ? "DESC" : "ASC";
      const { rows } = await exec(
        `SELECT * FROM cell_ltv
         WHERE grain = $1 AND (confidence >= $2 OR verdict = 'UNTAPPED')${filterSql}
         ORDER BY ${METRIC_SQL[applied.metric]} ${dir}, cell_key ASC
         LIMIT ${Math.max(1, Math.floor(applied.top_n))}`,
        params,
      );
      return { rows: rows.map(rowToCube), applied };
    },

    async getCell(key): Promise<CellDetail | null> {
      const cellRes = await exec("SELECT * FROM cell_ltv WHERE cell_key = $1", [key]);
      if (cellRes.rows.length === 0) return null;
      const cell = rowToCube(cellRes.rows[0]);

      const pinned = Object.entries(cell.dims).map(([d, v]) => `${d}=${v}`);
      const [seriesRes, effectsRes, childrenRes, chainRes] = await Promise.all([
        exec("SELECT * FROM series WHERE cell_key = $1", [key]),
        exec("SELECT * FROM dim_effects WHERE (dim || '=' || level) = ANY($1)", [pinned]),
        exec("SELECT * FROM cell_ltv WHERE parent_key = $1 ORDER BY spend_c DESC, cell_key ASC LIMIT 10", [key]),
        exec(
          `WITH RECURSIVE chain AS (
             SELECT c.*, 0 AS depth FROM cell_ltv c
             WHERE c.cell_key = (SELECT parent_key FROM cell_ltv WHERE cell_key = $1)
             UNION ALL
             SELECT p.*, chain.depth + 1 FROM cell_ltv p
             JOIN chain ON p.cell_key = chain.parent_key
           )
           SELECT * FROM chain ORDER BY depth ASC`,
          [key],
        ),
      ]);

      const s = seriesRes.rows[0];
      return {
        cell,
        series: s
          ? {
              cell_key: s.cell_key as string,
              week: s.week as string[],
              cum_rev_per_sub_c: s.cum_rev_per_sub_c as number[],
              cac_c: Number(s.cac_c),
              n: Number(s.n),
            }
          : null,
        effects_for_dims: effectsRes.rows.map((e) => ({
          dim: e.dim as DimName,
          level: e.level as string,
          effect_value_usd: Number(e.effect_value_usd),
          effect_conv: Number(e.effect_conv),
          n: Number(e.n),
        })),
        children_preview: childrenRes.rows.map(rowToCube),
        parent_chain: chainRes.rows.map(rowToCube),
      };
    },

    async drillDown(key) {
      const { rows } = await exec(
        "SELECT * FROM cell_ltv WHERE parent_key = $1 ORDER BY spend_c DESC, cell_key ASC",
        [key],
      );
      return rows.map(rowToCube);
    },

    async dailyBrief(): Promise<BriefArtifact> {
      const meta = await metaOnce;
      const { rows } = await exec("SELECT * FROM brief_cards ORDER BY ord ASC");
      const cards = rows.map((r) => ({
        cell_key: r.cell_key as string,
        verdict: r.verdict as CubeRow["verdict"],
        is_flip: Boolean(r.is_flip),
        dollar_impact_day_c: Number(r.dollar_impact_day_c),
        kind: r.kind as "bleed" | "upside",
        estimate_basis: r.estimate_basis as "measured" | "marginal_cac_naive",
        covered_leaves: Number(r.covered_leaves),
        also_visible_at: r.also_visible_at as string[],
        reason: r.reason as string,
      }));
      const headline = (meta as unknown as { headline_bleed_c: number; headline_upside_c: number });
      return {
        schema_version: 1,
        seed: meta.seed,
        snapshot_at: meta.snapshot_at,
        source: "synthetic",
        headline_bleed_c: headline.headline_bleed_c,
        headline_upside_c: headline.headline_upside_c,
        cards,
      };
    },

    async listFlips(minImpact_c = 0) {
      const { rows } = await exec(
        "SELECT * FROM cell_ltv WHERE is_flip AND dollar_impact_day_c >= $1 ORDER BY dollar_impact_day_c DESC, cell_key ASC",
        [minImpact_c],
      );
      return rows.map(rowToCube);
    },

    async findUntapped() {
      const { rows } = await exec(
        "SELECT * FROM cell_ltv WHERE verdict = 'UNTAPPED' ORDER BY dollar_impact_day_c DESC, cell_key ASC",
      );
      return rows.map(rowToCube);
    },

    meta: () => metaOnce,
  };
}

// ---------------------------------------------------------------------------
// Loader — the nightly-snapshot pattern: build into a staging schema, then
// swap atomically so readers never see a half-written world.
// ---------------------------------------------------------------------------

const CUBE_COLS = [
  "cell_key", "grain", "grain_mask", "dims", "parent_key", "n_subs", "spend_c",
  "last_week_spend_c", "realized_rev_c", "fe_rev_c", "be_rev_c", "pred_ltv_sum_c",
  "blended_rev_c", "maturity_frac", "cpl_c", "cac_c", "ltv_raw", "ltv_shrunk",
  "shrink_weight", "ci_low", "ci_high", "platform_roas", "confidence",
  "payback_day", "verdict", "leaning", "is_flip", "dollar_impact_day_c", "reason",
] as const;

async function insertJson(exec: Exec, table: string, cols: readonly string[], rows: unknown[], types: Record<string, string>) {
  const colDefs = cols.map((c) => `"${c}" ${types[c]}`).join(", ");
  for (let i = 0; i < rows.length; i += 1000) {
    const chunk = rows.slice(i, i + 1000);
    await exec(
      `INSERT INTO ${table} (${cols.map((c) => `"${c}"`).join(", ")})
       SELECT ${cols.map((c) => `x."${c}"`).join(", ")}
       FROM jsonb_to_recordset($1::jsonb) AS x(${colDefs})`,
      [JSON.stringify(chunk)],
    );
  }
}

/** Load a QueryData bundle into Postgres with an atomic staging swap. */
export async function loadIntoPg(exec: Exec, data: QueryData): Promise<void> {
  await exec("CREATE SCHEMA IF NOT EXISTS staging");
  await exec("SET search_path TO staging");
  for (const t of TABLES) await exec(`DROP TABLE IF EXISTS ${t}`);
  // One statement per exec call — PGlite prepared queries are single-statement.
  for (const stmt of DDL.split(";")) {
    if (stmt.trim()) await exec(stmt);
  }

  const cubeTypes: Record<string, string> = {
    cell_key: "text", grain: "text", grain_mask: "int", dims: "jsonb", parent_key: "text",
    n_subs: "int", spend_c: "int", last_week_spend_c: "int", realized_rev_c: "int",
    fe_rev_c: "int", be_rev_c: "int", pred_ltv_sum_c: "int", blended_rev_c: "int",
    maturity_frac: "double precision", cpl_c: "int", cac_c: "int",
    ltv_raw: "double precision", ltv_shrunk: "double precision", shrink_weight: "double precision",
    ci_low: "double precision", ci_high: "double precision", platform_roas: "double precision",
    confidence: "double precision", payback_day: "int", verdict: "text", leaning: "text",
    is_flip: "boolean", dollar_impact_day_c: "int", reason: "text",
  };
  await insertJson(exec, "cell_ltv", CUBE_COLS, data.rows, cubeTypes);

  await insertJson(
    exec,
    "brief_cards",
    ["ord", "cell_key", "verdict", "is_flip", "dollar_impact_day_c", "kind", "estimate_basis", "covered_leaves", "also_visible_at", "reason"],
    data.brief.cards.map((c, ord) => ({ ...c, ord })),
    { ord: "int", cell_key: "text", verdict: "text", is_flip: "boolean", dollar_impact_day_c: "int", kind: "text", estimate_basis: "text", covered_leaves: "int", also_visible_at: "jsonb", reason: "text" },
  );

  await insertJson(
    exec,
    "series",
    ["cell_key", "week", "cum_rev_per_sub_c", "cac_c", "n"],
    [...data.series.values()],
    { cell_key: "text", week: "jsonb", cum_rev_per_sub_c: "jsonb", cac_c: "int", n: "int" },
  );

  await insertJson(
    exec,
    "dim_effects",
    ["dim", "level", "effect_value_usd", "effect_conv", "n"],
    data.effects,
    { dim: "text", level: "text", effect_value_usd: "double precision", effect_conv: "double precision", n: "int" },
  );

  await exec("INSERT INTO snapshot_meta (id, meta) VALUES (1, $1::jsonb)", [
    JSON.stringify({ ...data.meta, headline_bleed_c: data.brief.headline_bleed_c, headline_upside_c: data.brief.headline_upside_c }),
  ]);

  // Atomic swap: readers on `public` never see a half-written snapshot.
  await exec("SET search_path TO public");
  await exec("BEGIN");
  for (const t of TABLES) await exec(`DROP TABLE IF EXISTS public.${t}`);
  for (const t of TABLES) await exec(`ALTER TABLE staging.${t} SET SCHEMA public`);
  await exec("COMMIT");
  await exec("DROP SCHEMA IF EXISTS staging CASCADE");
}
