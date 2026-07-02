/**
 * Ground Truth Postgres schema — the production serving store.
 *
 * Demo scale (6.6k cube rows) uses plain tables + btree/GIN indexes. At
 * event scale the production notes apply:
 *  - PARTITION cell_ltv BY LIST (grain): partition pruning makes every
 *    Explorer/MCP query hit one small partition.
 *  - Keep only the latest 1-2 snapshot_at values hot; older snapshots are
 *    the audit trail ("this cell flipped KILL→SCALE as the cohort matured").
 *  - The nightly job builds the cube in DuckDB over the event lake, then
 *    loads here with the same atomic swap used below.
 *
 * All money columns are integer cents (int4 is ample at demo scale; move
 * money columns to int8 when a single cell can exceed ~$21M).
 */

export const DDL = `
CREATE TABLE IF NOT EXISTS cell_ltv (
  cell_key            text PRIMARY KEY,
  grain               text NOT NULL,
  grain_mask          int  NOT NULL,
  dims                jsonb NOT NULL,
  parent_key          text,
  n_subs              int NOT NULL,
  spend_c             int NOT NULL,
  last_week_spend_c   int NOT NULL,
  realized_rev_c      int NOT NULL,
  fe_rev_c            int NOT NULL,
  be_rev_c            int NOT NULL,
  pred_ltv_sum_c      int NOT NULL,
  blended_rev_c       int NOT NULL,
  maturity_frac       double precision NOT NULL,
  cpl_c               int NOT NULL,
  cac_c               int NOT NULL,
  ltv_raw             double precision NOT NULL,
  ltv_shrunk          double precision NOT NULL,
  shrink_weight       double precision NOT NULL,
  ci_low              double precision NOT NULL,
  ci_high             double precision NOT NULL,
  platform_roas       double precision NOT NULL,
  confidence          double precision NOT NULL,
  payback_day         int,
  verdict             text NOT NULL,
  leaning             text,
  is_flip             boolean NOT NULL,
  dollar_impact_day_c int NOT NULL,
  reason              text NOT NULL
);
CREATE INDEX IF NOT EXISTS cell_ltv_grain_rank ON cell_ltv (grain, ltv_shrunk DESC);
CREATE INDEX IF NOT EXISTS cell_ltv_parent     ON cell_ltv (parent_key);
CREATE INDEX IF NOT EXISTS cell_ltv_flips      ON cell_ltv (dollar_impact_day_c DESC) WHERE is_flip;
CREATE INDEX IF NOT EXISTS cell_ltv_dims_gin   ON cell_ltv USING gin (dims);

CREATE TABLE IF NOT EXISTS brief_cards (
  ord                 int PRIMARY KEY,
  cell_key            text NOT NULL,
  verdict             text NOT NULL,
  is_flip             boolean NOT NULL,
  dollar_impact_day_c int NOT NULL,
  kind                text NOT NULL,
  estimate_basis      text NOT NULL,
  covered_leaves      int NOT NULL,
  also_visible_at     jsonb NOT NULL,
  reason              text NOT NULL
);

CREATE TABLE IF NOT EXISTS series (
  cell_key          text PRIMARY KEY,
  week              jsonb NOT NULL,
  cum_rev_per_sub_c jsonb NOT NULL,
  cac_c             int NOT NULL,
  n                 int NOT NULL
);

CREATE TABLE IF NOT EXISTS dim_effects (
  dim              text NOT NULL,
  level            text NOT NULL,
  effect_value_usd double precision NOT NULL,
  effect_conv      double precision NOT NULL,
  n                int NOT NULL,
  PRIMARY KEY (dim, level)
);

CREATE TABLE IF NOT EXISTS snapshot_meta (
  id   int PRIMARY KEY DEFAULT 1,
  meta jsonb NOT NULL
);
`;

export const TABLES = ["cell_ltv", "brief_cards", "series", "dim_effects", "snapshot_meta"] as const;
