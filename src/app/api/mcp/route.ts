import { createMcpHandler } from "mcp-handler";
import { z } from "zod";
import { GRAINS, THRESHOLDS } from "@/engine/config";
import { DIM_NAMES } from "@/engine/dims";
import {
  dailyBrief,
  drillDown,
  findUntapped,
  getCell,
  listFlips,
  queryCells,
} from "@/engine/query";
import { GrainNotAvailable, type CubeRow } from "@/engine/types";
import { loadArtifacts } from "@/lib/artifacts";
import { cellPath } from "@/lib/format";

/**
 * Ground Truth MCP server — read-only tools over the SAME query contract the
 * dashboard uses (SPEC §9). The agent narrates numbers computed by code; it
 * never computes LTV itself. Streamable HTTP, stateless: no SSE, no Redis.
 */

const GRAIN_NAMES = GRAINS.map((g) => g.name);
const GRAIN_LIST = GRAINS.map((g) => `${g.name} (${g.dims.join("×") || "portfolio"})`).join("; ");

const GUARDRAILS =
  "All data is SYNTHETIC demo data from a documented, seeded generator. " +
  "Cite cell_key values when making claims. Never recompute LTV yourself — narrate the returned numbers. " +
  "State the uncertainty range and evidence (n, maturity) alongside any recommendation. " +
  "WATCH verdicts mean 'not enough evidence' — do not over-read them; report the leaning only as a leaning.";

/** Compact row projection so tool results stay LLM-friendly. */
function slim(r: CubeRow) {
  return {
    cell_key: r.cell_key,
    cell: cellPath(r.dims),
    grain: r.grain,
    verdict: r.verdict,
    leaning: r.leaning,
    is_flip: r.is_flip,
    spend_usd: Math.round(r.spend_c / 100),
    true_ltv_per_dollar: r.ltv_shrunk,
    uncertainty_80pct: [r.ci_low, r.ci_high],
    platform_roas: r.platform_roas,
    dollar_impact_per_day_usd: Math.round(r.dollar_impact_day_c / 100),
    n_subs: r.n_subs,
    days_observed: Math.round(r.maturity_frac * 90),
    pct_borrowed_from_parent: Math.round(r.shrink_weight * 100),
    confidence: r.confidence,
  };
}

function json(payload: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(payload) }] };
}

function grainError(e: GrainNotAvailable) {
  // Informational content, NOT a protocol error — Claude self-corrects.
  return json({
    error: "grain_not_available",
    requested: e.requested,
    available_grains: e.available_grains,
    hint: "Re-query with one of the available grains. Per-dimension questions outside these grains (e.g. 'by placement overall') are answered by explain_cell / the decomposition, not by rank_cells.",
  });
}

const handler = createMcpHandler(
  (server) => {
    server.tool(
      "rank_cells",
      `Rank acquisition cells by a metric at a curated grain. Grains: ${GRAIN_LIST}. ${GUARDRAILS}`,
      {
        grain: z.enum(GRAIN_NAMES as [string, ...string[]]).describe("Curated grain name"),
        metric: z
          .enum(["ltv_per_dollar", "ltv_raw", "spend", "platform_roas", "flip_divergence", "dollar_impact"])
          .optional()
          .describe("Ranking metric (default ltv_per_dollar = the shrunk true LTV:CAC)"),
        filters: z
          .record(z.enum(DIM_NAMES as unknown as [string, ...string[]]), z.string())
          .optional()
          .describe('Dim filters, e.g. {"platform":"meta"}'),
        order: z.enum(["desc", "asc"]).optional(),
        top_n: z.number().int().min(1).max(100).optional(),
        min_confidence: z.number().min(0).max(1).optional().describe("Default 0.6; UNTAPPED rows are always included"),
      },
      async ({ grain, metric, filters, order, top_n, min_confidence }) => {
        const data = await loadArtifacts();
        try {
          const { rows, applied } = queryCells(data, {
            grain,
            metric,
            filters: filters as Partial<Record<(typeof DIM_NAMES)[number], string>>,
            order,
            top_n: top_n ?? 20,
            min_confidence,
          });
          return json({ applied, rows: rows.map(slim) });
        } catch (e) {
          if (e instanceof GrainNotAvailable) return grainError(e);
          throw e;
        }
      },
    );

    server.tool(
      "get_cell",
      `Full detail for one cell by cell_key: metrics, payback series, parent chain, children. ${GUARDRAILS}`,
      { cell_key: z.string().describe("Content-addressed cell key, e.g. from rank_cells") },
      async ({ cell_key }) => {
        const data = await loadArtifacts();
        const d = getCell(data, cell_key);
        if (!d) {
          return json({
            error: "cell_not_found",
            requested: cell_key,
            try: { flip_cell: data.meta.flip_cell_key, untapped_cell: data.meta.untapped_cell_key },
          });
        }
        return json({
          cell: { ...slim(d.cell), reason: d.cell.reason, dims: d.cell.dims, cpl_usd: d.cell.cpl_c / 100, cac_usd: d.cell.cac_c / 100, payback_day: d.cell.payback_day, realized_rev_usd: Math.round(d.cell.realized_rev_c / 100), front_end_rev_usd: Math.round(d.cell.fe_rev_c / 100), back_end_rev_usd: Math.round(d.cell.be_rev_c / 100) },
          payback_series: d.series
            ? { days: d.series.week, cum_rev_per_sub_usd: d.series.cum_rev_per_sub_c.map((c) => Math.round(c / 100)), cost_per_sub_usd: Math.round(d.series.cac_c / 100) }
            : null,
          parent_chain: d.parent_chain.map((p) => ({ cell_key: p.cell_key, cell: cellPath(p.dims), verdict: p.verdict })),
          children_preview: d.children_preview.map(slim),
        });
      },
    );

    server.tool(
      "explain_cell",
      `WHY a cell got its verdict: the plain-English reason, per-trait decomposition effects (what each pinned trait adds/subtracts), and evidence provenance. ${GUARDRAILS}`,
      { cell_key: z.string() },
      async ({ cell_key }) => {
        const data = await loadArtifacts();
        const d = getCell(data, cell_key);
        if (!d) return json({ error: "cell_not_found", requested: cell_key });
        return json({
          cell: cellPath(d.cell.dims),
          verdict: d.cell.verdict,
          leaning: d.cell.leaning,
          is_flip: d.cell.is_flip,
          reason: d.cell.reason,
          evidence: {
            n_subs: d.cell.n_subs,
            days_observed: Math.round(d.cell.maturity_frac * 90),
            pct_borrowed_from_parent: Math.round(d.cell.shrink_weight * 100),
            confidence: d.cell.confidence,
          },
          trait_effects: d.effects_for_dims.map((e) => ({
            trait: `${e.dim}=${e.level}`,
            value_effect_usd_per_buyer: e.effect_value_usd,
            front_end_conversion_effect_log_odds: e.effect_conv,
            n: e.n,
          })),
          note: "Effects come from a portfolio-wide regression over matured cohorts, centered within each dimension — 'what this trait adds, holding the others steady'.",
        });
      },
    );

    server.tool(
      "list_flips",
      `THE headline tool: cells the ad platform reports as winners (pixel ROAS ≥ 1) that actually LOSE money on 90-day truth. ${GUARDRAILS}`,
      { min_dollar_impact_per_day_usd: z.number().min(0).optional() },
      async ({ min_dollar_impact_per_day_usd }) => {
        const data = await loadArtifacts();
        const rows = listFlips(data, (min_dollar_impact_per_day_usd ?? 0) * 100);
        return json({
          flips: rows.map(slim),
          mechanism:
            "Platforms attribute gross purchases inside a 7-day window and never see refunds or missing renewals — impulse-heavy cells look great to the pixel and bleed on the back end.",
        });
      },
    );

    server.tool(
      "find_untapped",
      `Cells that are barely funded but whose trait composition predicts outsized LTV per dollar — speculative by design, labeled as such. ${GUARDRAILS}`,
      {},
      async () => {
        const data = await loadArtifacts();
        return json({
          untapped: findUntapped(data).map(slim),
          caveat:
            "Imputed from the decomposition (damped trait stacking ÷ sibling CPL), not observed performance. Recommend test budgets, not full scaling.",
        });
      },
    );

    server.tool(
      "daily_brief",
      `The Morning Brief: two headline numbers (measured bleed, hedged upside) and the deduplicated move list. Dollars are counted once, at the leaf level. ${GUARDRAILS}`,
      {},
      async () => {
        const data = await loadArtifacts();
        const brief = dailyBrief(data);
        return json({
          headline_bleed_usd_per_day: Math.round(brief.headline_bleed_c / 100),
          headline_upside_usd_per_day: Math.round(brief.headline_upside_c / 100),
          upside_basis: "marginal_cac_naive — assumes the next dollar performs like the last; say so when quoting it",
          moves: brief.cards.map((c) => ({
            cell_key: c.cell_key,
            verdict: c.verdict,
            is_flip: c.is_flip,
            kind: c.kind,
            dollar_impact_per_day_usd: Math.round(c.dollar_impact_day_c / 100),
            covers_leaf_cells: c.covered_leaves,
            corroborated_at_other_grains: c.also_visible_at.length,
            reason: c.reason,
          })),
          snapshot_at: data.meta.snapshot_at,
        });
      },
    );

    server.tool(
      "drill_down",
      `Children of a cell (one level deeper in the grain hierarchy). ${GUARDRAILS}`,
      { cell_key: z.string() },
      async ({ cell_key }) => {
        const data = await loadArtifacts();
        return json({ children: drillDown(data, cell_key).slice(0, 30).map(slim) });
      },
    );

    server.tool(
      "draft_budget_change",
      "Draft a REVERSIBLE budget-change proposal from verdicts. Returns a structured proposal + CSV. This tool NEVER executes anything and never touches any ad platform — a human reviews and applies it. Never claim a change was made.",
      {
        changes: z
          .array(
            z.object({
              cell_key: z.string(),
              action: z.enum(["pause", "decrease", "increase", "test"]),
              delta_pct: z.number().min(-100).max(200).optional().describe("Budget delta in percent (ignored for pause)"),
            }),
          )
          .min(1)
          .max(20),
      },
      async ({ changes }) => {
        const data = await loadArtifacts();
        const lines: string[] = ["cell_key,cell,action,delta_pct,current_spend_per_day_usd,verdict,evidence"];
        const items = [];
        for (const ch of changes) {
          const row = data.byKey.get(ch.cell_key);
          if (!row) {
            items.push({ ...ch, error: "cell_not_found" });
            continue;
          }
          const spendDay = Math.round(row.last_week_spend_c / 7 / 100);
          items.push({
            ...ch,
            cell: cellPath(row.dims),
            current_spend_per_day_usd: spendDay,
            verdict: row.verdict,
            reversible: true,
            executed: false,
          });
          lines.push(
            `${ch.cell_key},"${cellPath(row.dims)}",${ch.action},${ch.delta_pct ?? ""},${spendDay},${row.verdict},"n=${row.n_subs} ${Math.round(row.maturity_frac * 90)}d"`,
          );
        }
        return json({
          proposal: {
            status: "DRAFT — not executed; read-only tool by design",
            items,
            created_from_snapshot: data.meta.snapshot_at,
          },
          csv: lines.join("\n"),
        });
      },
    );

    // ---- resources: keep answers honest + citable --------------------------
    server.resource("methodology", "groundtruth://methodology", async () => {
      const data = await loadArtifacts();
      return {
        contents: [
          {
            uri: "groundtruth://methodology",
            mimeType: "application/json",
            text: JSON.stringify({
              data: "100% synthetic from a seeded, documented generator; the planted answer key ships in truth_effects.json and is never read by the model/cube/query code (import-graph-tested).",
              prediction: "Two-part model: chance a subscriber ever buys × what buyers like them spend, scaled so predictions average out correctly on cohorts whose 90-day outcome is already known (per whale-eligible stratum).",
              shrinkage: `Thin cells borrow from their parent: weight = k/(k+n) with k=${THRESHOLDS.k_shrink} — a cell needs ~${THRESHOLDS.k_shrink} subscribers to mostly stand alone.`,
              uncertainty: "80% ranges; verdicts gate on the range bound, never the point estimate.",
              verdicts: "KILL: even the high end loses. TRIM: below break-even at high spend. SCALE: even the low end clears with margin. UNTAPPED: composed traits predict value, spend is starved — speculative. WATCH: not enough evidence (leaning shown).",
              validate: data.meta.validate,
            }),
          },
        ],
      };
    });
    server.resource("thresholds", "groundtruth://thresholds", async () => {
      const data = await loadArtifacts();
      return {
        contents: [
          {
            uri: "groundtruth://thresholds",
            mimeType: "application/json",
            text: JSON.stringify({ thresholds: THRESHOLDS, grains: data.meta.grains }),
          },
        ],
      };
    });
  },
  {
    serverInfo: { name: "ground-truth", version: "1.0.0" },
  },
  {
    basePath: "/api",
    verboseLogs: false,
    maxDuration: 60,
  },
);

export { handler as GET, handler as POST, handler as DELETE };
