# Ground Truth — Build Spec (v1.0)

> **The** build spec for the It's Today Media $5,000 Build Challenge entry. Supersedes stack choices in `SYSTEM-DESIGN-v1.md` / `UI-AND-DATA-DESIGN-v1.md` where they conflict (see §3 pivot table); those docs remain canonical for rationale, UI detail, and DGP math.
> **Status:** v1.0 draft — pending adversarial verification pass.
> **Dates:** authored 2026-07-01. **Submission deadline 2026-07-04 23:59 ET** (≈3.5 days). Registration approved — we are cleared to build.

---

## 0. TL;DR

**Ground Truth** is a read-only "profit-truth" engine for a FinPub media-buying team: it attributes back-end 90-day subscriber LTV to the granular acquisition **cell** (platform × account × campaign × audience × creative/angle × placement × geo × device × offer × cohort-week), predicts LTV early from first-3–7-day behavior, shrinks thin cells toward their hierarchy parents, and emits confidence-gated **SCALE / KILL / TRIM / WATCH / UNTAPPED** verdicts — headlined by **the flip**: cells the ad platform calls winners that are real-payback losers.

**Demo reality:** data is **honest-synthetic** from a documented, seeded data-generating process (DGP) with planted effects and a `validate()` gate that guarantees the flip + an untapped cell exist and are recoverable. Transparency about this is the pitch, not a caveat.

**Stack (locked):** One TypeScript monorepo → one Next.js 15 App-Router app on Vercel. The data engine (DGP → scoring → cube → shrinkage → decomposition → verdicts) is pure TS run as a build-time script producing **static JSON snapshot artifacts**; route handlers serve them through **one shared query contract** used identically by the React UI and a **read-only MCP server** (`mcp-handler`) at `/api/mcp`. No Python, no database, no external service the demo can die on.

---

## 1. Mission & judging context

- **Contest:** It's Today Media "$5,000 Build Challenge" — hiring contest for an AI-first Marketing Development Engineer. Build any AI tool that helps their media-buying team.
- **Judged on:** Problem Selection (heaviest) · Functionality · Code Quality · README ("Why this?" / "What's next?").
- **Deliverables:** live demo URL + GitHub repo + README. Konner records the demo walkthrough.
- **Deadline:** submission closes **2026-07-04 23:59 ET**. Internal target: **feature-freeze end of July 3, submit July 4 by ~18:00 ET** (buffer for deploy/video/submission friction).
- **Audience:** an Agora-lineage direct-response FinPub shop (~12 people, ~7 Agora alumni, founder = ex-Advertising Director). They already run Claude/Cursor/MCP (mcp.itstoday.org), a funnel generator, and an SMS platform. They think in CPL/CAC/ROAS/LTV/payback and blended MER. The tool must speak that language natively.
- **Why this problem wins Problem Selection:** their own job ad optimizes "front-end (CPL/CTR/CVR/ROAS) and downstream value (LTV, payback, Total ROI)." FinPub economics = break even on the front end, get paid on the 90-day back end — exactly the revenue the ad platforms' 7-day attribution window cannot see. Off-the-shelf (Triple Whale, Northbeam) is DTC-shaped, not FinPub-targeting-cell-shaped. Knowing true LTV per cell = "permission to outbid."

## 2. The product in one paragraph + the two money shots

A media buyer opens the **Morning Brief** and reads: *"$3,400/day misallocated across 9 live cells. 6 moves."* Each move is a card: verdict badge, cell path, true LTV:CAC bullet bar with confidence interval against 1×/2×/3× ticks, a platform-vs-truth dumbbell, dollar impact per day, and a maturity badge. Clicking drills into the **Explorer** (sortable multi-grain cell table + treemap) and then a **Cell Detail** page that proves the claim: flip gauge, payback curve crossing the CAC line, per-dimension decomposition tornado, maturity/provenance panel. A **Proposal Cart** drafts (never executes) budget changes as CSV/Slack text. A **read-only MCP server** exposes the same numbers as tools so Claude can narrate — never compute — the answers.

- **Money shot #1 — THE FLIP:** `Meta × crypto-curious × hype/10x × Reels × mobile` — platform 7-day ROAS ≈ 2.0–2.5× (buyer screams SCALE) but true 90-day LTV:CAC ≈ 0.55 (KILL): impulse tripwire buyers who refund and never renew.
- **Money shot #2 — THE UNTAPPED:** `YouTube × retirement × education × newsletter-cross-promo × desktop × FL` — weak 7-day ROAS so the buyer starves it, but true LTV:CAC ≈ 4.8 — surfaced only via back-end attribution + shrinkage + decomposition-based imputation.

## 3. Locked decisions — the Next.js-first pivot

Konner's constraints: **use Next.js for as much as possible; host on Vercel.** Combined with 3.5 days and a demo that must not die during judging, this pivots the stack:

| Concern | Old design (v1 docs) | **This spec (locked)** | Why |
|---|---|---|---|
| Language | Python (numpy, LightGBM) + TS UI | **100% TypeScript** | One toolchain, one repo, Next-native; judges see a coherent codebase |
| DGP | Python + numpy RNG | **TS `src/engine/` with seeded PRNG (`pure-rand`) + hand-rolled distributions** | Deterministic, testable, no Python runtime anywhere |
| Early-LTV model | LightGBM Tweedie/quantile | **Two-part GLM in TS: logistic P(buy) + ridge on log(spend|buy)** | Closed-form-ish, transparent, inspectable — *better* README story ("every prediction is auditable"); production path = LightGBM, stated in README |
| Cell-level CI | per-sub p10/p50/p90 from GBM | **Cell-level posterior CI from EB shrinkage + sampling variance** | Statistically cleaner where CIs actually matter (cells), much cheaper to build |
| Build store | DuckDB GROUPING SETS | **TS cube builder over in-memory arrays (~50k subs) → curated grain list** | Same curated-grains concept; 50k rows is trivially in-memory |
| Serve store | Postgres (Neon) | **Static JSON snapshot artifacts in `data/artifacts/`, read by route handlers via `fs` + module-level cache** | Zero infra risk, zero cold-start dependency, judging-proof; the *snapshot* was already the architecture — production path (DuckDB→Postgres) stated in README |
| MCP server | separate service | **`mcp-handler` route at `/api/mcp` in the same Next app** | Vercel-native MCP; huge judge resonance (they run mcp.itstoday.org) |
| Live Meta ingestion | Day-1 real Meta pull | **Cut from demo. Documented production rail only** (`/c` redirect + `/postback` described in README architecture; optional P2 illustrative endpoints) | Konner's real data access is limited; the DGP is the demo's data source; per risk #1/#4 of SYSTEM-DESIGN |
| Charts | Tremor + Recharts | **Recharts + custom Tailwind micro-viz (bullet bars, dumbbells, meters as divs/SVG)** | One chart dep; Tremor adds React-version risk for zero unique value |
| UI kit | — | **Tailwind v4 + shadcn/ui primitives + lucide-react** | Fast, modern, judge-familiar |
| Auth | — | **None. Public demo, synthetic data only** | Nothing sensitive; friction kills demos |

**Unchanged from v1 docs (still canonical):** 10-dimension registry with fixed bit positions; `grain_mask` bit SET = dimension pinned; curated grains (not full cube); EB shrinkage down the delivery hierarchy H0–H4; predicted+realized coexist per cube row; one shared query contract for UI and MCP; five verdicts + FLIP as overlay property; 90-day LTV horizon; verdicts gate on interval bounds, never point estimates; `validate()` must pass before any build ships; transparency/README-as-product.

## 4. Non-goals (demo scope)

- No live ad-platform API calls, no OAuth, no writes to any ad platform (proposals are drafts/CSV only).
- No database, no queue, no cron (the "nightly snapshot" is a build-time script for the demo).
- No auth/multi-user, no mobile-first layouts (desktop-first; readable at 1280px+; no broken mobile, but no mobile polish).
- No per-subscriber UI (cells only; subscriber table exists only inside the engine).
- No real PII anywhere, ever. All data synthetic; `source: "synthetic"` tagged on every artifact.

## 5. Repo & project layout

Repo root: `F:\Side-Projects\its-today-media-challenge\ground-truth\` (own git repo → private GitHub `ground-truth`, shared at submission).

```
ground-truth/
├── src/
│   ├── app/
│   │   ├── (dashboard)/
│   │   │   ├── brief/page.tsx            # Morning Brief (home; / redirects here)
│   │   │   ├── explore/page.tsx          # Cell Explorer (table + treemap)
│   │   │   └── cell/[key]/page.tsx       # Cell Detail
│   │   ├── api/
│   │   │   ├── cells/route.ts            # GET /api/cells — the query contract
│   │   │   ├── cells/[key]/route.ts      # GET /api/cells/:key — one cell + series + effects
│   │   │   ├── brief/route.ts            # GET /api/brief — daily brief payload
│   │   │   └── mcp/route.ts              # MCP server (mcp-handler)
│   │   ├── layout.tsx · globals.css
│   ├── engine/                           # pure TS, zero Next imports — unit-testable
│   │   ├── config.ts                     # DGP config + thresholds (single source of truth)
│   │   ├── rand.ts                       # seeded RNG + distributions
│   │   ├── dgp/                          # hierarchy, truth_effects, spend, subscribers, revenue
│   │   ├── model/                        # two-part GLM, ridge, EB shrinkage, decomposition
│   │   ├── cube.ts                       # curated-grain cube builder (grain_mask)
│   │   ├── verdicts.ts                   # decision engine + flip + brief assembly
│   │   ├── validate.ts                   # the demo-guarantee gate
│   │   └── query.ts                      # queryCells(CellQuery) over loaded artifacts
│   ├── lib/                              # artifact loader (fs + cache), formatting, cell-key codec
│   └── components/                       # ui/ (shadcn), viz/ (BulletBar, Dumbbell, Tornado…), screens/
├── scripts/generate.ts                   # runs engine end-to-end → data/artifacts/ (tsx)
├── data/artifacts/                       # committed, regenerable: snapshot JSONs (§6)
├── tests/                                # vitest: engine + query contract + API
├── docs/                                 # SPEC.md (this file), plan, architecture mermaid
├── public/
├── CLAUDE.md · README.md · .gitignore · package.json · next.config.ts · tsconfig.json
```

**Toolchain:** Node 20+, npm (zero-install-risk on this Windows box), Next.js 15 (App Router, TS strict), Tailwind v4, shadcn/ui, Recharts, `mcp-handler` + `zod`, `pure-rand`, vitest + tsx for scripts/tests. ESLint + `tsc --noEmit` + vitest are the pre-commit quality gates (per global CLAUDE.md).

**Artifacts are committed** (deterministic from seed; `npm run generate` reproduces byte-identical output). This makes the deploy bulletproof, lets the README link exact artifacts, and keeps Vercel builds fast. `generate` runs in CI/prebuild only as a check (P1), not as a deploy dependency.

## 6. Data artifacts & schemas

All money in **integer cents** internally; formatted at the edge. All artifacts carry `{schema_version, seed, generated_at, source: "synthetic"}` envelopes.

### 6.1 Dimension registry (fixed bit positions — never reorder)

| bit | dim | example values |
|---|---|---|
| 0 | `platform` | meta, google, taboola, tiktok |
| 1 | `ad_account` | act_meta_1 … (~12, 2–4/platform) |
| 2 | `campaign` | cmp_inflation_q2 … (~200, Zipf) |
| 3 | `audience` | retirement, dividend-income, options-traders, crypto-curious, gold-bugs, inflation-worriers, broad, lookalike (8) |
| 4 | `creative` (carries angle) | education, income, fear-inflation, hype-10x, patriotic, contrarian, ai-boom, end-of-dollar, research (9 angles × variants) |
| 5 | `placement` | fb-feed, reels, yt-instream, native-widget, newsletter-cross-promo, search (6) |
| 6 | `geo` | FL, AZ, TX, CA, NY, … (12) |
| 7 | `device` | desktop, mobile, tablet (3) |
| 8 | `offer` | tripwire-7, core-99, premium-199, managed-money-2k (4) |
| 9 | `cohort_week` | 2026-W12 … W25 (14) |

`grain_mask` = Σ `1<<bit` over **pinned** dims. `cell_key` = `"c" + base36(fnv1a64(grain_mask + canonical dims))` — stable, URL-safe, used in routes (`/cell/[key]`) and MCP.

### 6.2 Curated grains (~18 — the only grain_masks that exist)

Delivery spine: `{}` global · `{platform}` · `{platform,account}` · `{…,campaign}` · `{…,audience}` · `{…,creative}` (full leaf). Facet cross-cuts: `platform×{geo|device|offer}`, `campaign×{geo|device|offer}` (campaign implies platform+account pinned), `audience×creative`, `platform×audience`, `platform×creative`. Time twins: `platform×cohort_week`, `campaign×cohort_week`. Singles for Explorer pivots: `{audience}`, `{creative}`.

### 6.3 Artifact files

| file | shape | est. size | consumers |
|---|---|---|---|
| `meta.json` | config echo, seed, thresholds, generated_at, validate() report | ~10 KB | Methodology drawer, README |
| `cube.json` | `CubeRow[]` across all curated grains (~15–25k rows) | 8–15 MB | `query.ts` (everything) |
| `decisions.json` | `DecisionRow[]` + assembled `brief` (headline $, grouped moves) | ~200 KB | Brief, Explorer badges, MCP `daily_brief`/`list_flips` |
| `series.json` | `cell_key → {week[], cum_rev_per_sub[], cac, n}` for material cells (n≥25 or in brief) + all campaign+ grains | 1–3 MB | Cell Detail payback curve |
| `dim_effects.json` | `{dim, level, effect_usd, n}[]` (decomposition main effects) | ~20 KB | Tornado, Explorer rail, MCP `explain_cell`, untapped imputation |
| `recovery.json` | planted-vs-recovered pairs + corr; shrinkage-vs-raw error table | ~30 KB | Methodology drawer, README charts |
| `truth_effects.json` | the planted answer key (multiplier tables) | ~15 KB | README/methodology ONLY — **never read by `query.ts`/model code paths** |

If `cube.json` exceeds ~20 MB, split per-grain (`cube/{mask}.json`) and lazy-load — the loader interface hides this.

### 6.4 Core row types (exact TS — the contract between engine, API, UI, MCP)

```ts
type DimName = "platform"|"ad_account"|"campaign"|"audience"|"creative"|"placement"|"geo"|"device"|"offer"|"cohort_week";
type Verdict  = "SCALE"|"KILL"|"TRIM"|"WATCH"|"UNTAPPED";

interface CubeRow {
  cell_key: string;
  grain_mask: number;
  dims: Partial<Record<DimName, string>>;   // exactly the pinned dims
  parent_key: string | null;                 // delivery-hierarchy parent (lowest set hierarchy bit cleared)
  n_subs: number;
  spend_c: number;                           // cents
  realized_rev_c: number;                    // booked-to-date, censored at snapshot
  pred_ltv_sum_c: number;                    // Σ per-sub predicted 90d LTV
  blended_rev_c: number;                     // realized + max(pred−realized,0)·(1−maturity)
  maturity_frac: number;                     // mean(min(age,90)/90) over subs
  cpl_c: number; cac_c: number;              // spend/optins, spend/buyers (0-safe)
  ltv_raw: number;                           // blended_rev / spend
  ltv_shrunk: number;                        // EB posterior mean of ltv_per_dollar
  shrink_weight: number;                     // w = k/(k+n): 1 → fully parent
  ci_low: number; ci_high: number;           // 80% interval on ltv_per_dollar
  platform_roas: number;                     // plat_conv_value / spend (the lie)
  confidence: number;                        // 0..1 composite (n, maturity, shrink)
}

interface DecisionRow {
  cell_key: string;
  verdict: Verdict;
  is_flip: boolean;                          // platform_roas ≥ 1 ∧ ci_high < hurdle
  dollar_impact_day_c: number;               // bleed (KILL/TRIM) or headroom (SCALE/UNTAPPED)
  reason: string;                            // precomputed plain-English one-liner
}

interface CellQuery {                        // ONE contract: UI fetches + MCP tools are presets of this
  grain: DimName[];
  filters: Partial<Record<DimName, string>>;
  metric: "ltv_per_dollar"|"blended_ltv"|"realized_rev"|"platform_roas"|"spend"|"flip_divergence";
  min_confidence: number;                    // default 0.6
  hurdle: number;                            // default 1.0
  order: "desc"|"asc";
  top_n: number;                             // default 50, max 500
}
```

## 7. Engine spec (pure TS, `src/engine/`)

Every module: plain functions, no I/O except `scripts/generate.ts`; deterministic given `(config, seed)`; vitest-covered.

### 7.1 `rand.ts` — seeded randomness
`pure-rand` xoroshiro128+ streams, one child stream per stage (spend, subs, revenue…). Distributions implemented + property-tested against known moments: `normal` (Box-Muller), `lognormal`, `poisson` (Knuth <30, normal approx above), `binomial`, `bernoulli`, `pareto(x_m, α)`, `zipf(α, n)` (via rejection or precomputed CDF).

### 7.2 `dgp/` — the synthetic world (math per UI-AND-DATA-DESIGN §3, unchanged)
1. **Hierarchy build:** cardinalities per §6.1; Zipf campaign propensities; `truth_effects` multiplier tables (`m_cac, m_feconv, m_ltv, m_refund` per level) with the planted FLIP and UNTAPPED cells (§2). Baselines `CAC0=$30`, `LTV0=$40`.
2. **Spend:** `spend = propensity · daily_curve · lognormal_noise`; `cac = CAC0 · Πm_cac · fatigue(week) · noise`; `n_subs ~ Poisson(spend/cac)`; 1–2 macro-shock weeks pump fear-angle `m_feconv`. UNTAPPED cell gets starved propensity.
3. **Subscribers:** latent quality `z ~ Normal(μ_cell, 0.7)`, `μ_cell = log Π m_ltv`; early behaviors (opens, clicks, sms_optin, first_purchase) generated as noisy children of `z` per §3.4 — hype cells get high first_purchase but low engagement (the learnable flip signal).
4. **Revenue (full 90d generated, then censored):** optin $0 · front-end sale d0–3 (this is what the platform pixel sees) · core sale d3–30 · affiliate commission d5–90 (sparse lognormal) · monthly renewals (survival) · managed-money whale d20–90 `Pareto(1000, 1.6)` (retirement/dividend only) · refunds d3–30 negative. Zero-inflation P(LTV=0) ≈ 0.55–0.70.
5. **Platform view:** `plat_conv_value = in-window(7d) front-end revenue × over-attribution factor (1.1–1.35)` → `platform_roas` per cell — the number the flip is measured against.
6. **Censoring:** snapshot date = end of week 14; `realized_*` fields censor each sub at `min(age, snapshot)`; `true_ltv_90d` kept in a truth sidecar for validation only.

**Volume:** ~50k subs, 14 weeks, ~8–18k realized leaf cells, ~70% with ≤5 subs (sparsity emerges from Poisson, not assigned).

### 7.3 `model/` — predict, shrink, decompose
- **Two-part early-LTV GLM** (trained on matured cohorts, i.e. weeks 1–5 at snapshot): (a) L2-logistic `P(rev>0 | early behaviors, dims)` via IRLS; (b) ridge on `log(rev) | rev>0`. `E[LTV] = p̂ · exp(μ̂ + σ̂²/2)`. Features: z-scored behaviors + one-hot dims (~260 cols, sparse accumulation of XᵀX → Cholesky solve — ~5M ops, instant). Per-sub `pred_ltv_90d`; `pred_remaining = max(pred − realized_so_far, 0)`.
- **EB shrinkage (per cube row, top-down by popcount(grain_mask)):** `w = k/(k + n_subs)` (k≈30, in config); `ltv_shrunk = w·parent.ltv_shrunk + (1−w)·ltv_raw`. Variance: `var_post = (1−w)·var_raw/n + w·var_prior_floor`; 80% CI = shrunk ± 1.2816·√var_post, where `var_raw` = empirical per-sub blended-value variance in the cell (spend is deterministic, so CI on rev/spend is CI on rev ÷ known spend).
- **Decomposition:** ridge (λ=1.0) of `asinh(per-sub blended LTV)` on one-hot main effects of all 9 non-time dims; effects centered within dim; reported in approx $ at baseline. Doubles as **UNTAPPED imputation**: predicted ltv_per_dollar for a zero-spend cell = compose main effects down its path ÷ baseline CAC × cell `m_cac` estimate from observed CPL of siblings.
- **Model eval (goes in `recovery.json` + README):** corr(recovered dim effects, planted `log m_ltv`) target ≥ 0.8; shrinkage-beats-raw MAE table on held-out cells vs truth sidecar; calibration deciles predicted-vs-true.

### 7.4 `cube.ts` — one pass per curated grain
Group subscribers + spend to each grain in §6.2; compute every `CubeRow` field; wire `parent_key`; assemble child links implicitly via `parent_key` (drill-down = `WHERE parent_key = X` in `query.ts`).

### 7.5 `verdicts.ts` — decision engine (constants in `config.ts`)
Hurdle H=1.0 · margin=0.15 · n_floor=30 · conf_floor=0.6 · untapped_mult=1.3 · spend floors = quantiles of leaf spend.
- SCALE: `ci_low > H+margin ∧ n ≥ n_floor ∧ confidence ≥ conf_floor`
- KILL: `ci_high < H ∧ spend material`
- TRIM: `ltv_shrunk < H ≤ ci_high ∧ spend high`
- UNTAPPED: `imputed ltv_per_dollar > H·untapped_mult ∧ spend < p20`
- WATCH: everything else (young/thin/straddling); **UI forces WATCH visual muting + disabled proposal below maturity gates**
- FLIP overlay: `platform_roas ≥ 1.0 ∧ ci_high < H`
- `dollar_impact_day` = bleed for KILL/TRIM (`spend_day · (1 − ltv_shrunk)` capped ≥0), headroom for SCALE/UNTAPPED (marginal-CAC-naive estimate, labeled as such).
- Assembles `brief`: headline `$X/day misallocated` = Σ|impacts| of actionable cells; groups Kill/Flip → Trim → Scale → Untapped → Watch, sorted by impact × confidence.

### 7.6 `validate.ts` — the demo-guarantee gate (build FAILS if any assert fails)
1. FLIP cell: platform_roas in top decile of its grain ∧ true ltv:cac < 1.0 ∧ verdict ∈ {KILL,TRIM} ∧ is_flip.
2. UNTAPPED cell: imputed ltv:cac > 1.3·H ∧ spend < p20 ∧ verdict = UNTAPPED.
3. Sparsity: ≥60% of leaf cells have n ≤ 5.
4. Recovery: corr(recovered, planted) ≥ 0.8; shrunk MAE < raw MAE on thin held-out cells.
5. Brief is non-degenerate: ≥4 verdict groups populated, headline ≥ $1,000/day.
6. Every `decisions` row's cell exists in cube; every brief cell has a series entry.

### 7.7 `query.ts` — the shared contract
`queryCells(q: CellQuery): CellResult[]` + `getCell(key)`, `drillDown(key)`, `findUntapped()`, `dailyBrief()`, `listFlips(minImpact)` — pure functions over the loaded artifacts (module-cached). **Both** `/api/*` routes and MCP tools call these — the UI and the agent literally cannot disagree.

## 8. API contract (route handlers, all GET, all read-only)

- `GET /api/cells?grain=platform,audience&filters[platform]=meta&metric=ltv_per_dollar&min_confidence=0.6&hurdle=1&order=desc&top_n=50` → `{rows: (CubeRow & DecisionRow)[], applied: CellQuery}` — 400 + zod error detail on bad params.
- `GET /api/cells/:key` → `{cell, decision, series, effects_for_dims, children_preview, parent_chain}`.
- `GET /api/brief` → `{headline_c, groups: {verdict, rows[]}[], snapshot_meta}`.
- Artifacts loaded via `src/lib/artifacts.ts`: `fs.readFile` from `data/artifacts/`, `JSON.parse`, module-level cache; `next.config.ts` sets `outputFileTracingIncludes: {"/api/**": ["./data/artifacts/**"]}` so Vercel bundles them. Pages use the same loaders directly in RSC (no self-fetch).

## 9. MCP server (`/api/mcp`, `mcp-handler`)

Tools (zod-schema'd, thin wrappers over §7.7 — return the same JSON the UI renders):
`rank_cells(grain, filters?, metric?, min_confidence?, top_n?)` · `get_cell(cell_key)` · `explain_cell(cell_key)` (decomposition + verdict reason + shrinkage provenance) · `list_flips(min_dollar_impact?)` · `find_untapped()` · `daily_brief()` · `draft_budget_change(changes[])` → returns a structured reversible proposal object + CSV string; **never executes anything**.
Resources: `methodology` (model card + honest-synthetic notes), `thresholds`, `glossary`.
Guardrails in tool descriptions: cite cell_keys; never recompute LTV; state confidence; prefer back-end truth over platform numbers; refuse to over-read WATCH cells.
README includes a "connect Claude to this MCP" snippet (`npx mcp-remote https://<demo>/api/mcp` + Claude Desktop/Code config) — judges can interrogate the demo's own data live from Claude. That interop moment is a core wow.

## 10. UI spec (compressed; full detail canonical in UI-AND-DATA-DESIGN §1)

**Aesthetic:** financial-terminal-meets-Linear. Dark default, dense, numeric tabular-nums, verdict color system (SCALE green · KILL red · TRIM amber · WATCH slate · UNTAPPED blue · FLIP warning diamond), one display serif for the headline dollar figure. Use `frontend-design` + `dataviz` skills at build time. Desktop-first.

**Routes (3) + overlays (2):**
1. `/brief` — Portfolio strip (Spend, True MER vs Platform MER, $ at stake, live-cell counts); headline sentence; verdict-grouped Decision Cards (hero bullet bar + CI vs 1×/2×/3×; dumbbell platform→truth; $/day; maturity badge; Add to Proposal).
2. `/explore` — dense sortable Cell Table (path, verdict, spend, CPL, CAC, platform ROAS, true LTV:CAC + CI, payback, headroom, maturity, sparkline), grain preset selector + filter chips (URL-encoded state), treemap toggle (spend area, verdict color), decomposition side rail. Sub-maturity rows muted.
3. `/cell/[key]` — Flip Gauge (dumbbell/slope + plain-English why), payback curve (cum rev/sub vs CAC line, confidence cone), decomposition tornado (click → Explorer pivot), maturity/provenance meter ("n=412 · 38d · 18% borrowed from parent"), early-behavior calibration inset (P1), proposal panel.
- **Proposal Cart** (slide-over): staged moves, net $/day, export CSV / copy-to-Slack. **Methodology drawer:** honest-synthetic explainer, planted-vs-recovered scatter, shrinkage table, thresholds, glossary. Persistent "⚗ Synthetic demo data" pill opens it.

**Viz build order (all Recharts or hand-rolled SVG/div):** BulletBar+CI (div) → Dumbbell (SVG) → PaybackCurve (Recharts Line/Area) → Tornado (Recharts horizontal Bar) → Sparkline (Recharts tiny Line) → Treemap (Recharts Treemap) → Quadrant scatter (P1) → MaturityMeter (div).

## 11. Quality gates & testing

- **Engine (vitest):** RNG distribution moments; DGP invariants (spend>0, censoring correct, whale gating); GLM recovers a known linear signal on a toy fixture; EB shrinkage limits (n→∞ ⇒ raw, n→0 ⇒ parent); verdict truth-table over crafted rows; `validate()` green on default seed; cell_key codec round-trip; `queryCells` grain/filter/gate semantics.
- **API:** route tests for param validation + contract shape (vitest + direct handler invocation).
- **Pre-commit (per global CLAUDE.md):** `npm run lint` + `tsc --noEmit` + `npm test` clean; no console.log; no secrets (none exist — no env vars at all in the demo).
- **Pre-submit checklist:** validate() report in `meta.json` green · Lighthouse ≥ 90 on `/brief` · all three routes + both overlays work on the live URL cold · MCP endpoint answers `daily_brief` from a fresh client · README quickstart followed verbatim on a clean clone.

## 12. Deployment

Vercel (Hobby), project `ground-truth`, deploy via `vercel` CLI; production = `main`. No env vars, no external services. Artifacts ship with the repo → immutable deploys. `vercel:deploy` skill for the mechanics. Deploy a hello-world on Day 0 so the pipe is proven before it matters; deploy at least daily after.

## 13. README & submission (a scored deliverable — budget real hours)

Sections: **Why this?** (their economics in their language, the attribution-window mechanism, the flip) · **What it does** (90-second walkthrough with screenshots) · **The honest-synthetic data** (full DGP disclosure: hierarchy, multiplier tables, planted stories, `validate()` invariants, recovery proof charts) · **Architecture** (mermaid; snapshot artifact = the contract; production path: real ingestion rail `/c`+postback, DuckDB→Postgres, LightGBM upgrade — pulled from SYSTEM-DESIGN §8) · **MCP** (connect-your-Claude instructions) · **What's next** (guardrailed execute step, multi-platform, survival models, Thompson allocation) · **Cost model** (tokens are a rounding error; the bill is the join) · **Run it** (clone → `npm i` → `npm run generate` → `npm run dev`).
Submission July 4: live URL + repo + README per contest form; Konner records the demo video.

## 14. Timeline (aggressive but honest — ~3 working days)

| Milestone | Target | Contents |
|---|---|---|
| **M0 — rails** | tonight (Jul 1) | Scaffold (create-next-app, Tailwind, shadcn, vitest, lint), repo + first deploy (hello world), CLAUDE.md, spec merged into `docs/` |
| **M1 — engine** | Jul 2 midday | rand + config + DGP + models + cube + verdicts + validate green + artifacts committed + tests |
| **M2 — spine** | Jul 2 night | query.ts + `/api/*` + Brief + Explorer (table, grain presets, filters) live on Vercel |
| **M3 — proof** | Jul 3 | Cell Detail + Methodology drawer + Proposal cart + MCP endpoint + visual polish pass |
| **M4 — ship** | Jul 4 by 18:00 ET | README + recovery charts + Lighthouse + pre-submit checklist + Konner records video + **submit** |

**Scope tiers (cut order is bottom-up within P1 then P2):**
- **P0 (must):** engine + validate + artifacts · /api/cells + /api/brief · Brief · Explorer table w/ grain presets + filters · Cell Detail (flip gauge, payback, tornado, maturity) · Methodology drawer · MCP (rank/get/explain/list_flips/daily_brief) · README · live deploy.
- **P1 (should):** Proposal cart + draft_budget_change + CSV · treemap · find_untapped tool + untapped UI group · sparklines · calibration inset · keyboard nav (j/k/s) · CI check that regenerates artifacts.
- **P2 (nice):** quadrant scatter · embedded chat panel · illustrative `/c` + `/postback` endpoints · real-data CSV blend · predictive-power-vs-N panel.

## 15. Risks (updated for this stack)

| # | Risk | Mitigation |
|---|---|---|
| 1 | **3.5-day squeeze** — M1 slips and everything cascades | Engine is pure TS with no UI deps → parallelizable with scaffold; scope tiers pre-agreed; the spine (Brief→Explorer→Detail on P0 viz) is demoable even if P1 never lands |
| 2 | **TS statistics quietly wrong** (IRLS divergence, EB mis-shrink) | Property tests with known answers; `validate()` recovery assert is an end-to-end statistical test; fallbacks: logistic via plain gradient descent w/ fixed steps; if two-part GLM underperforms, degrade to dims-only ridge (still recovers planted effects by construction) |
| 3 | **`mcp-handler` friction on Vercel** (transport/versioning) | Time-boxed spike during M2; fallback = plain JSON-RPC POST route implementing the 5 read tools (MCP is JSON-RPC; a minimal handler is ~100 lines); worst case: tools documented + Claude Desktop config against `/api/*` REST via fetch skill |
| 4 | **Artifact size vs serverless limits** | Budget: cube ≤ 20 MB; per-grain file split ready; series capped to material cells; measure in M1 |
| 5 | **Recharts/React 19 or Tailwind v4 incompatibilities** | Pin versions at scaffold; every viz has a hand-rolled SVG/div fallback (bullet, dumbbell, meter already are) |
| 6 | **Demo fragility at judging** | No DB, no env, no external API; artifacts baked into the deploy; cold-start = fs read + JSON.parse (~100ms); pre-submit cold-URL checklist |
| 7 | **Synthetic data reads as toy** | Transparency-as-product: methodology drawer, planted-vs-recovered proof, README DGP disclosure; production ingestion rail documented with real API specifics |

## 16. Open questions for the adversarial review

1. Is committing 10–20 MB of JSON artifacts to git acceptable, or should generation move to Vercel build (`prebuild`)?
2. Is the two-part GLM + EB CI construction sound enough to survive a technical judge, or does any claim need weakening/reframing?
3. Does anything in §10 overpromise for the time available (treemap? calibration inset?) — is the P0 line drawn right?
4. Is `mcp-handler` the right MCP path on Vercel today, and does `mcp-remote` interop work as described?
5. Are the decomposition-based UNTAPPED imputation and its `validate()` assert actually achievable with sparse Zipf campaigns (identifiability)?
6. Anything about the Brief headline math (`$X/day misallocated`) that a media buyer would call BS on?
