import type { DimName, Dims } from "./dims";

/** Shared contract types — consumed by engine, API routes, UI, and MCP. */

export type Verdict = "SCALE" | "KILL" | "TRIM" | "WATCH" | "UNTAPPED";

export interface CubeRow {
  cell_key: string;
  grain: string; // registry name (§6.2)
  grain_mask: number;
  dims: Dims;
  parent_key: string | null; // per the grain-registry parent table
  n_subs: number;
  spend_c: number;
  last_week_spend_c: number; // last complete cohort week
  realized_rev_c: number;
  fe_rev_c: number; // front-end revenue (d0–7)
  be_rev_c: number; // back-end revenue (d8+)
  pred_ltv_sum_c: number;
  blended_rev_c: number;
  maturity_frac: number; // mean(min(age,90)/90)
  cpl_c: number; // spend / opt-ins
  cac_c: number; // spend / buyers (0 buyers → 0; UI renders "—")
  ltv_raw: number; // blended_rev / spend
  ltv_shrunk: number; // EB posterior mean of LTV-per-dollar (UI "true LTV:CAC")
  shrink_weight: number; // UI: "% borrowed from parent"
  ci_low: number; // 80% uncertainty interval on ltv_shrunk
  ci_high: number;
  platform_roas: number; // gross in-window conv value / spend (the lie)
  confidence: number; // composite, formula pinned in config
  payback_day: number | null; // day cum rev/sub crosses CAC; null = no crossing
  verdict: Verdict; // engine-final (WATCH forcing applied in engine)
  leaning: Verdict | null; // raw verdict when forced to WATCH
  is_flip: boolean; // platform_roas ≥ 1 ∧ ci_high < hurdle ∧ verdict ∈ {KILL,TRIM}
  dollar_impact_day_c: number; // §7.5; 0 for WATCH
  reason: string; // precomputed plain-English one-liner
}

export interface BriefCard {
  cell_key: string;
  verdict: Verdict;
  is_flip: boolean;
  dollar_impact_day_c: number;
  kind: "bleed" | "upside";
  estimate_basis: "measured" | "marginal_cac_naive";
  covered_leaves: number; // "covers N child cells"
  also_visible_at: string[]; // overlapping cell_keys folded into this card
  reason: string;
}

export interface BriefArtifact extends ArtifactEnvelope {
  headline_bleed_c: number; // measured: Σ KILL/TRIM impacts (leaf-disjoint)
  headline_upside_c: number; // hedged: Σ SCALE/UNTAPPED impacts (naive marginal)
  cards: BriefCard[];
}

export interface SeriesEntry {
  cell_key: string;
  week: string[]; // cohort-relative week labels ("wk 1"… or ISO weeks)
  cum_rev_per_sub_c: number[]; // cumulative net revenue per subscriber
  cac_c: number; // horizontal reference line
  n: number;
}

export interface DimEffect {
  dim: DimName;
  level: string;
  effect_value_usd: number; // value family: $ effect on buyers (asinh-ridge, centered)
  effect_conv: number; // conversion family: log-odds of buying (IRLS logistic)
  n: number; // subscribers at this level (training population)
}

export interface CellQuery {
  grain: string | DimName[]; // registry name, or dims validated against the registry
  filters: Partial<Record<DimName, string>>;
  metric: "ltv_per_dollar" | "ltv_raw" | "spend" | "platform_roas" | "flip_divergence" | "dollar_impact";
  min_confidence: number; // ranking gate only (default 0.6)
  hurdle: number; // default 1.0
  order: "desc" | "asc";
  top_n: number; // default 50, max 500
}

/** Typed error for a well-formed but non-curated grain (§6.4). */
export class GrainNotAvailable extends Error {
  constructor(
    public readonly requested: string,
    public readonly available_grains: { name: string; dims: DimName[] }[],
  ) {
    super(
      `Grain "${requested}" is not materialized. Available grains: ${available_grains
        .map((g) => g.name)
        .join(", ")}. Per-dimension effects outside these grains are available via explain_cell / dim_effects.`,
    );
    this.name = "GrainNotAvailable";
  }
}

export interface ArtifactEnvelope {
  schema_version: 1;
  seed: number;
  snapshot_at: string; // deterministic DGP snapshot instant (config), never wall-clock
  source: "synthetic";
}

export interface ValidateReport {
  core: { name: string; pass: boolean; detail: string }[];
  stats: { name: string; pass: boolean; detail: string }[];
  core_pass: boolean;
  stats_pass: boolean;
}

export interface MetaArtifact extends ArtifactEnvelope {
  config_echo: Record<string, unknown>;
  grains: { name: string; dims: DimName[]; grain_mask: number; parent: string | null }[];
  flip_cell_key: string;
  untapped_cell_key: string;
  validate: ValidateReport;
}
