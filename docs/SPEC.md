# Ground Truth — Build Spec (v1.1, adversarially verified)

> **The** build spec for the It's Today Media $5,000 Build Challenge entry. Supersedes stack choices in `SYSTEM-DESIGN-v1.md` / `UI-AND-DATA-DESIGN-v1.md` where they conflict; those docs remain canonical for rationale and extended UI detail.
> **Status:** v1.1 — verified by a 98-agent adversarial review (6 lenses → 46 deduped findings → 2-refuter panels each → 22 confirmed + 7 contested adopted-with-judgment, 17 refuted). All surviving fixes are integrated below.
> **Dates:** authored 2026-07-01. **Submission closes 2026-07-04 23:59 ET.** Internal targets: feature-freeze Jul 3 night, **submit-ready 15:00 ET Jul 4**, submit ≤ 18:00 ET.
> **v1.0 → v1.1 changelog:** Next.js 15→16 · explainability principle (§3.5) · grain registry + story grains + explicit parent table (§6.2) · CubeRow carries verdicts; decisions.json = brief only (§6.3–6.4) · DGP: 18 weeks, impulse-OTO flip mechanic, gross 7-day platform window, whale winsorize (§7.2) · exact CI formula, stratified calibration factor, two-family decomposition, corrected UNTAPPED imputation (§7.3) · engine-level WATCH forcing + `leaning`, verdict precedence, within-grain spend floors, greedy leaf-disjoint brief, bleed/upside headline split (§7.5) · validate:core vs validate:stats + 7 new asserts (§7.6) · typed GrainNotAvailable (§7.7) · MCP: basePath, HTTP transport pinned, spike moved to Day 0 (§9) · P0 acceptance floors per component (§10) · Lighthouse demoted to advisory with explicit waiver (§11) · README as running thread + backup video Jul 3 (§13) · P1 cut order re-ranked (§14).

---

## 0. TL;DR

**Ground Truth** is a read-only "profit-truth" engine for a FinPub media-buying team: it attributes back-end 90-day subscriber LTV to the granular acquisition **cell** (platform × account × campaign × audience × creative/angle × placement × geo × device × offer × cohort-week), predicts LTV early from first-3–7-day behavior, shrinks thin cells toward their hierarchy parents, and emits confidence-gated **SCALE / KILL / TRIM / WATCH / UNTAPPED** verdicts — headlined by **the flip**: cells the ad platform calls winners that are real-payback losers.

**Demo reality:** data is **honest-synthetic** from a documented, seeded data-generating process (DGP) with planted effects and a `validate()` gate that guarantees the flip + an untapped cell exist and are recoverable. Transparency about this is the pitch, not a caveat.

**Stack (locked, scaffolded, deployed):** One TypeScript repo → one **Next.js 16.2** App-Router app on Vercel (live since Day 0). The data engine (DGP → scoring → cube → shrinkage → decomposition → verdicts) is pure TS run as a build-time script producing **static JSON snapshot artifacts**; route handlers serve them through **one shared query contract** used identically by the React UI and a **read-only MCP server** (`mcp-handler`) at `/api/mcp`. No Python, no database, no env vars, no external service the demo can die on.

**The Brief headline is two numbers, never one:** measured **bleed** ("Bleeding $2,100/day across 5 cells") and hedged **upside** ("+$1,300/day potential if reallocated — naive marginal estimate"). Summing them into one "misallocated" figure is the first thing an ex-Agora advertising director would BS-check.

## 1. Mission & judging context

- **Contest:** It's Today Media "$5,000 Build Challenge" — hiring contest for an AI-first Marketing Development Engineer. Build any AI tool that helps their media-buying team.
- **Judged on:** Problem Selection + README/written explanation (weighted heaviest) · Functionality ("ugly and functional beats beautiful and broken") · Code Quality.
- **Deliverables:** live demo URL (preferred; Loom acceptable) + GitHub repo + README. Konner records the walkthrough; a rough backup take is recorded at Jul 3 feature freeze so the polished video can never block submission.
- **Audience:** an Agora-lineage direct-response FinPub shop (~12 people, founder = ex-Advertising Director). They already run Claude/Cursor and their own MCP server in production. They think in CPL/CAC/ROAS/LTV/payback and blended MER. The tool must speak that language natively.
- **Why this problem wins Problem Selection:** their own job ad optimizes "front-end (CPL/CTR/CVR/ROAS) and downstream value (LTV, payback, Total ROI)." FinPub economics = break even on the front end, get paid on the 90-day back end — exactly the revenue the ad platforms' 7-day attribution window cannot see. Off-the-shelf (Triple Whale, Northbeam) is DTC-shaped, not FinPub-targeting-cell-shaped. Knowing true LTV per cell = "permission to outbid."

## 2. The product in one paragraph + the two money shots

A media buyer opens the **Morning Brief**: *"Bleeding $2,100/day across 5 cells; +$1,300/day potential upside. 6 moves."* Each move is a card: verdict badge, cell path, true LTV:CAC bullet bar with an uncertainty range against 1×/2×/3× ticks, a platform-vs-truth dumbbell, $/day, and a maturity badge. Clicking drills into the **Explorer** (sortable multi-grain cell table) and then a **Cell Detail** page that proves the claim: flip gauge, payback curve crossing the CAC line, per-dimension decomposition tornado, maturity/provenance panel. A **Proposal Cart** drafts (never executes) budget changes as CSV/Slack text. A **read-only MCP server** exposes the same numbers as tools so Claude can narrate — never compute — the answers.

- **Money shot #1 — THE FLIP** (planted at grain `{platform, audience, creative, placement, device}`): `Meta × crypto-curious × hype-10x × Reels × mobile`. Mechanism: impulse tripwire buyers take an immediate $99 one-time-offer inside the platform's 7-day window (platform sees gross ≈ $7 + 0.3×$99, over-attributed ×1.1–1.35 → **platform ROAS ≈ 2.0–2.5×**, a "winner"), then refund at 1.8× baseline and never renew → net 90-day LTV ≈ $8 → **true LTV:CAC ≈ 0.55 = KILL**. Platforms never see refunds; that asymmetry IS the product thesis, stated in the Methodology drawer.
- **Money shot #2 — THE UNTAPPED** (same grain, no geo pin): `YouTube × retirement × education × newsletter-cross-promo × desktop`. High planted `m_ltv` (LTV:CAC ≈ 4.8) but weak 7-day signal → the buyer starves it (Zipf propensity floored) → surfaced only via back-end attribution + decomposition imputation. Florida appears as narrative color from `dim_effects` ("retiree-heavy geos amplify this"), not as a pinned dimension — pinning geo would explode cube cardinality for zero story value.

Both cells are declared as named constants in `config.ts` (`FLIP_CELL`, `UNTAPPED_CELL`); `generate.ts` records their `cell_key`s in `meta.json`; `validate()` asserts on those exact rows; the Explorer ships a "Story cells" grain preset so a judge can navigate to them in two clicks.

## 3. Locked decisions — the Next.js-first pivot

Konner's constraints: **use Next.js for as much as possible; host on Vercel.** Combined with ~3 days and a demo that must not die during judging:

| Concern | Old design (v1 docs) | **This spec (locked)** | Why |
|---|---|---|---|
| Language | Python (numpy, LightGBM) + TS UI | **100% TypeScript** | One toolchain; judges see one coherent codebase |
| Framework | Next.js 15 | **Next.js 16.2 (App Router, TS strict, Turbopack)** — scaffolded and deployed | What `create-next-app@latest` ships today; `params`/`searchParams` are async (`await props.params`) — mandatory in 16 |
| DGP | Python + numpy RNG | **TS `src/engine/` with seeded streams (`pure-rand` 8, subpath API) + hand-rolled distributions** — built, tested | Deterministic, testable, no Python anywhere |
| Early-LTV model | LightGBM Tweedie/quantile | **Two-part model in TS: L2-logistic P(buy) (IRLS) + ridge on log(rev\|buy), × stratified empirical calibration factor** | Transparent and explainable (§3.5); production path = LightGBM, stated in README |
| Cell-level uncertainty | per-sub p10/p50/p90 from GBM | **Cell-level 80% uncertainty interval: delta-method variance + EB shrinkage (§7.3, exact formula)** | Uncertainty where decisions gate; buildable and defensible |
| Build store | DuckDB GROUPING SETS | **TS cube builder over in-memory arrays → curated grain registry** | ~65k subs is trivially in-memory |
| Serve store | Postgres (Neon) | **Static JSON snapshot artifacts in `data/artifacts/`, `fs`-read + module cache** | Zero infra risk; the snapshot was already the architecture; production path (DuckDB→Postgres) in README |
| MCP server | separate service | **`mcp-handler` route in the same app; HTTP transport only** | Vercel-native; judges run their own MCP in production |
| Live Meta ingestion | Day-1 real Meta pull | **Cut from demo; documented production rail** (`/c` redirect + `/postback` in README architecture) | The DGP is the demo's data source |
| Charts | Tremor + Recharts | **Recharts + hand-rolled Tailwind/SVG micro-viz** (bullet, dumbbell, meter are divs/SVG) | One chart dep; every viz has a hand-rolled fallback |
| UI kit | — | **Tailwind v4 + shadcn/ui + lucide-react** | Fast, modern |
| Auth | — | **None. Public demo, synthetic data only** | Nothing sensitive; friction kills demos |

**Unchanged from v1 docs:** 10-dim registry, frozen bit positions; grain_mask bit SET = pinned; curated grains only; EB shrinkage toward parents; predicted+realized coexist per row; one shared query contract; five verdicts + FLIP overlay; 90-day LTV horizon; verdicts gate on interval bounds; `validate()` before ship; transparency-as-product.

### 3.5 The explainability principle (Konner's constraint — vetoes sophistication)

**Every number on the dashboard must be explainable by Konner in one or two plain sentences, without a math background.** Consequences:
- Methods stay low-level: `k/(k+n)` shrinkage ("a thin cell borrows from its parent until it has earned trust — k is how many subscribers it takes to mostly stand alone"); two-part prediction ("chance they ever buy × what buyers like them spend"); calibration factor ("we scale predictions so they average out correctly on cohorts whose outcome we already know, separately for whale-eligible audiences"); decomposition ("one number per trait: what it adds or subtracts, holding the others steady").
- UI copy is plain English: "uncertainty range" (never "credible interval"/"posterior"), "% borrowed from parent" (never "shrinkage weight"), "confidence" (never "posterior probability").
- The Methodology drawer gives every formula a one-sentence gloss next to it.
- Any reviewer/finding proposing added statistical sophistication is rejected unless it *simplifies* the explanation or is required for correctness.

## 4. Non-goals (demo scope)

No live ad-platform APIs, OAuth, or writes to platforms (proposals = drafts/CSV only) · no database/queue/cron (the "nightly snapshot" is a build-time script) · no auth/multi-user · no mobile polish (desktop-first, readable ≥1280px, nothing broken) · no per-subscriber UI · no real PII ever; every artifact tagged `source: "synthetic"`.

## 5. Repo & project layout

Repo: `F:\Side-Projects\its-today-media-challenge\ground-truth\` → private GitHub `Konnerfinney/ground-truth`, `main` = production, Vercel project `ground-truth` (live). Commit small and often; push each unit.

```
ground-truth/
├── src/
│   ├── app/
│   │   ├── brief/page.tsx                # Morning Brief (/ redirects here); force-static
│   │   ├── explore/page.tsx              # Cell Explorer (dynamic: searchParams)
│   │   ├── cell/[key]/page.tsx           # Cell Detail (dynamic)
│   │   ├── api/
│   │   │   ├── cells/route.ts            # GET — the query contract
│   │   │   ├── cells/[key]/route.ts      # GET — one cell + series + effects
│   │   │   ├── brief/route.ts            # GET — brief payload
│   │   │   └── mcp/route.ts              # MCP server (mcp-handler, {basePath:'/api'})
│   │   ├── layout.tsx · globals.css
│   ├── engine/                           # pure TS, zero Next imports — DONE so far: rand.ts, dims.ts, model/{linalg,fit}.ts
│   │   ├── config.ts                     # DGP config, thresholds, GRAIN REGISTRY + parent table, FLIP_CELL/UNTAPPED_CELL
│   │   ├── types.ts                      # CubeRow, BriefCard, CellQuery, artifact envelopes
│   │   ├── rand.ts · dims.ts             # seeded RNG/distributions · bits/masks/cellKey
│   │   ├── dgp/                          # hierarchy, truth, spend, subscribers, revenue
│   │   ├── model/                        # linalg, fit (ridge/IRLS), ltv (two-part), shrink (EB), decompose
│   │   ├── cube.ts · verdicts.ts · validate.ts · query.ts
│   ├── lib/                              # artifacts loader (fs + cache), format (cents→$)
│   └── components/                       # ui/ (shadcn), viz/, screens/
├── scripts/generate.ts                   # engine end-to-end → data/artifacts/ (tsx)
├── data/artifacts/                       # committed, deterministic (see §6, §7.6)
├── tests/                                # vitest (29 passing at v1.1 time)
├── docs/SPEC.md                          # this file
├── AGENTS.md (project instructions; CLAUDE.md → @AGENTS.md) · README.md
```

**Toolchain (installed, versions pinned by lockfile):** Node 25 local / Vercel default, npm, Next 16.2.10, React 19.2, Tailwind v4, Recharts 3.9, `mcp-handler` 1.1 (+ `@modelcontextprotocol/sdk` 1.26, zod 4), `pure-rand` 8.4, vitest 4, tsx. ESLint 9 flat config (verify `eslint .` actually lints; scaffold's bare `eslint` script must be checked).
**Repo hygiene:** `.gitattributes` with `* text=auto eol=lf` and `data/artifacts/** -text linguist-generated` so byte-identical regeneration survives the Windows dev box and artifact diffs don't drown PRs.

## 6. Data artifacts & schemas

Money = **integer cents** internally. Every artifact carries `{schema_version, seed, snapshot_at, source: "synthetic"}` — `snapshot_at` is the **deterministic** DGP snapshot instant from config (end of final cohort week), NOT a wall-clock build time; this is what makes `npm run generate` byte-identical (P1 CI check: `npm run generate && git diff --exit-code data/artifacts/`).

### 6.1 Dimension registry (fixed bit positions — never reorder; implemented in `dims.ts`)

| bit | dim | values |
|---|---|---|
| 0 | `platform` | meta, google, taboola, tiktok |
| 1 | `ad_account` | ~12 (2–4/platform) |
| 2 | `campaign` | ~200, Zipf-weighted |
| 3 | `audience` | retirement, dividend-income, options-traders, crypto-curious, gold-bugs, inflation-worriers, broad, lookalike |
| 4 | `creative` (carries angle) | education, income, fear-inflation, hype-10x, patriotic, contrarian, ai-boom, end-of-dollar, research |
| 5 | `placement` | fb-feed, reels, yt-instream, native-widget, newsletter-cross-promo, search |
| 6 | `geo` | FL, AZ, TX, CA, NY + 7 more |
| 7 | `device` | desktop, mobile, tablet |
| 8 | `offer` | tripwire-7, core-99, premium-199, managed-money-2k |
| 9 | `cohort_week` | **18 weeks** 2026-W08…W25 (extended from 14 so 5 cohorts are fully 90d-mature at snapshot) |

`cell_key` = `"c" + base36(fnv1a32(canonical) ) + base36(fnv1a32("gt:"+canonical))` — content-addressed from pinned dim values only (no seed, no data), so keys survive regeneration.

### 6.2 The grain registry (config.ts — the ONLY grains that exist; closure-tested)

Each entry: `{name, dims[], grain_mask, parent_grain}`. **The parent table is explicit and hand-authored** (the v1.0 one-line "clear lowest hierarchy bit" rule was wrong for facet/time grains — confirmed blocker). Derivation guidance: drop facet/time dims first, then the deepest hierarchy dim; story grains pin their parents explicitly. A config unit test asserts **closure** (every parent_grain is itself in the registry) and `validate()` asserts every non-global cube row's `parent_key` resolves to an existing row.

| # | name | dims | parent |
|---|---|---|---|
| 0 | global | — | — |
| 1 | platform | platform | global |
| 2 | account | platform, ad_account | platform |
| 3 | campaign | platform, ad_account, campaign | account |
| 4 | adset | …campaign + audience | campaign |
| 5 | leaf | …adset + creative | adset |
| 6 | platform×audience | platform, audience | platform |
| 7 | audience×creative | audience, creative | audience |
| 8 | platform×creative | platform, creative | platform |
| 9–11 | platform×{geo\|device\|offer} | platform + facet | platform |
| 12–14 | campaign×{geo\|device\|offer} | campaign dims + facet | campaign |
| 15 | platform×cohort | platform, cohort_week | platform |
| 16 | campaign×cohort | campaign dims + cohort_week | campaign |
| 17–20 | singles: audience · creative · geo · offer | one dim | global |
| 21 | **story-3** | platform, audience, creative | platform×audience |
| 22 | **story-5 (FLIP/UNTAPPED grain)** | platform, audience, creative, placement, device | story-3 |

(~23 grains; leaf ≈ 8–18k rows, story-5 bounded by realized atoms — trivial at ~65k subs. Estimated cube total ≤ 30k rows.)

### 6.3 Artifact files

| file | contents | consumers |
|---|---|---|
| `meta.json` | config echo, seed, thresholds, snapshot_at, grain registry, **FLIP/UNTAPPED expected cell_keys**, validate() report | Methodology, README, tests |
| `cube.json` | `CubeRow[]` for all curated grains — **verdict fields live here** (est. 10–18 MB; split per-grain `cube/{mask}.json` if > 20 MB — loader interface hides it) | `query.ts` (everything) |
| `decisions.json` | the assembled **brief only**: `{headline_bleed_c, headline_upside_c, cards: BriefCard[]}` (greedy leaf-disjoint selection, §7.5) | Brief, MCP `daily_brief`/`list_flips` |
| `series.json` | `cell_key → {week[], cum_rev_per_sub_c[], cac_c, n}` for brief cells + all campaign-or-shallower grains + story cells | Payback curve |
| `dim_effects.json` | **two families**: `{dim, level, effect_value_usd, effect_conv, n}` (value = $ on buyers; conv = log-odds of buying) | Tornado, Explorer rail, `explain_cell`, UNTAPPED imputation |
| `recovery.json` | planted-vs-recovered (both families) + corr, **negative control** (corr vs permuted key ≈ 0), shrunk-beats-raw MAE, calibration deciles (out-of-sample) | Methodology, README charts |
| `truth_effects.json` | the planted answer key | README/methodology ONLY — a **vitest import-graph test** asserts nothing under `engine/{model,cube,query}` imports it |

### 6.4 Core row types (exact TS — the contract)

```ts
type DimName = "platform"|"ad_account"|"campaign"|"audience"|"creative"|"placement"|"geo"|"device"|"offer"|"cohort_week";
type Verdict  = "SCALE"|"KILL"|"TRIM"|"WATCH"|"UNTAPPED";

interface CubeRow {
  cell_key: string; grain: string; grain_mask: number;
  dims: Partial<Record<DimName, string>>;
  parent_key: string | null;              // per the grain registry parent table
  n_subs: number;
  spend_c: number; last_week_spend_c: number;   // last complete cohort week
  realized_rev_c: number; fe_rev_c: number; be_rev_c: number;  // front/back-end split (global-row waterfall)
  pred_ltv_sum_c: number; blended_rev_c: number; maturity_frac: number;
  cpl_c: number; cac_c: number;            // 0-safe: null-semantics via -1? NO — use 0 spend ⇒ row excluded from cube (only realized cells exist)
  ltv_raw: number; ltv_shrunk: number;     // ltv-per-dollar, raw vs shrunk (UI "true LTV:CAC" = ltv_shrunk)
  shrink_weight: number;                   // UI: "% borrowed from parent"
  ci_low: number; ci_high: number;         // 80% uncertainty interval on ltv_shrunk (§7.3)
  platform_roas: number;
  confidence: number;                      // §7.5 composite, formula pinned in config
  payback_day: number | null;              // day cum-rev/sub crosses CAC; null = no crossing by snapshot
  verdict: Verdict;                        // engine-final (WATCH-forcing applied here, not in UI)
  leaning: Verdict | null;                 // raw verdict when forced to WATCH ("needs ~X more days — leaning KILL")
  is_flip: boolean;                        // platform_roas ≥ 1 ∧ ci_high < hurdle ∧ verdict ∈ {KILL,TRIM}
  dollar_impact_day_c: number;             // signed per §7.5; 0 for WATCH
  reason: string;                          // precomputed plain-English one-liner
}

interface BriefCard {                      // decisions.json
  cell_key: string; verdict: Verdict; is_flip: boolean;
  dollar_impact_day_c: number; kind: "bleed"|"upside";
  estimate_basis: "measured"|"marginal_cac_naive";
  covered_leaves: number;                  // "covers N child cells"
  also_visible_at: string[];               // overlapping cells folded into this card (cross-grain corroboration)
  reason: string;
}

interface CellQuery {
  grain: string | DimName[];               // registry name, or dims resolved+validated against the registry
  filters: Partial<Record<DimName, string>>;
  metric: "ltv_per_dollar"|"ltv_raw"|"spend"|"platform_roas"|"flip_divergence"|"dollar_impact";
  // ltv_per_dollar ⇒ ltv_shrunk; flip_divergence ⇒ |platform_roas − ltv_shrunk|
  min_confidence: number;                  // default 0.6 — RANKING gate only; UNTAPPED/WATCH surfaces set it lower explicitly
  hurdle: number;                          // default 1.0
  order: "desc"|"asc"; top_n: number;      // default 50, max 500
}
```

Unknown grain ⇒ typed **`GrainNotAvailable`** carrying `{requested, available_grains}` — API maps to 400 with that JSON; the MCP wrapper returns it as *informational text content* (never a protocol error) so Claude self-corrects and re-queries. The `rank_cells` tool description enumerates the registry and states: *"per-dimension effects outside these grains come from `explain_cell`/dim_effects (decomposition), not rank_cells."* Unknown `cell_key` on `/cell/[key]`, `/api/cells/:key`, `get_cell` ⇒ friendly not-found with links to the story cells (never a 500).

## 7. Engine spec (pure TS, `src/engine/`)

Deterministic given `(config, seed)`; every module vitest-covered. **Done at v1.1:** `rand.ts` (+14 tests), `dims.ts` (+10; its generic `parentOf` is superseded by the §6.2 parent table — remove/repurpose when config lands), `model/linalg.ts` + `model/fit.ts` (+6: Cholesky, ridge contrasts, IRLS under separation).

### 7.2 `dgp/` — the synthetic world (deltas from UI-AND-DATA-DESIGN §3 marked ★)
1. **Hierarchy + truth:** cardinalities per §6.1; Zipf campaigns; `truth_effects` multipliers (`m_cac, m_feconv, m_ltv, m_refund`); baselines CAC0=$30, LTV0=$40; FLIP_CELL/UNTAPPED_CELL constants.
2. **Spend:** `spend = propensity · weekly_curve · lognormal_noise`; `cac = CAC0 · Πm_cac · fatigue · noise`; `n_subs ~ Poisson(spend/cac)`; macro-shock weeks; UNTAPPED starved. ★18 weeks (W08–W25); tune weekly volume to land ~50–65k subs while keeping ≥60% of leaves at n≤5.
3. **Subscribers:** latent `z ~ Normal(log Πm_ltv, 0.7)`; behaviors (opens, clicks, sms_optin, first_purchase) as noisy children of z; hype cells: high first_purchase, low engagement.
4. **Revenue (full 90d generated, then censored at snapshot):** optin $0 · front-end sale d0–3 · ★**impulse-OTO**: `first_purchase=1` buyers take an immediate core-99 OTO at d0–2 with `P = logistic(a + b·log Πm_feconv)` (≈0.25–0.35 in hype/crypto cells vs ≈0.05 baseline); OTO buyers carry `m_refund`-elevated refunds d3–30 and ~zero renewals · core sale d3–30 · affiliate commission d5–90 · monthly renewals (survival) · managed-money whale d20–90 `Pareto(1000, 1.6)`, retirement/dividend only, ★**winsorized at `whale_cap_usd` = $25k** (stabilizes variances; disclosed in Methodology) · refunds negative.
5. **Platform view ★:** `plat_conv_value = GROSS purchase revenue with days_since_acq ≤ 7 × over_attribution(1.1–1.35)`; **refunds never subtracted** (platforms don't see them). Flip cell ⇒ platform ROAS ≈ ($7 + P_OTO·$99)·1.25/$14 ≈ 2.0–2.5×.
6. **Censoring:** `snapshot_at` = end of W25 (config constant). Realized fields censor at snapshot; `true_ltv_90d` in the truth sidecar only.

### 7.3 `model/` — predict, calibrate, shrink, decompose (plain-English gloss in parentheses)
- **Training set:** subscribers with `age_at_snapshot ≥ 90d` (cohorts W08–W12; ~12–18k subs) — their realized revenue at snapshot IS their true 90d LTV by construction; no sidecar access. Hold out 20% for out-of-sample calibration/recovery charts. cohort_week is NOT a model feature (unseen future levels).
- **Two-part model:** (a) L2-logistic `P(rev>0 | behaviors, dims)` via IRLS, λ=1.0 ("chance they ever buy"); (b) ridge on `log(rev) | rev>0`, λ=1.0 ("what buyers like them spend"). Point prediction: `Ê[LTV] = p̂ · exp(Xβ̂) · S_g` where **S_g = mean(exp(residual))** over training buyers in stratum g ∈ {whale-eligible (audience ∈ {retirement, dividend-income}), rest} ("we scale predictions so they average out right on cohorts we already know, separately for whale-eligible audiences" — Duan smearing, cited in Methodology). Per-sub predictive variance `v_pred = p̂·m₂ − (p̂·m₁)²` with `m₁ = exp(Xβ̂)·S_g`, `m₂ = exp(2Xβ̂)·S₂g` (`S₂g = mean(exp(2·residual))`).
- **Blending per cube row:** `blended_rev_c = realized_rev_c + Σ_subs (1 − maturity_i) · max(pred_i − realized_i, 0)`; `ltv_raw = blended_rev_c / spend_c`.
- **EB shrinkage (top-down by grain depth via the parent table):** `w = k/(k+n_subs)` (k=30); `ltv_shrunk = w·parent.ltv_shrunk + (1−w)·ltv_raw`.
- **Uncertainty (exact, delta method — v1.0's formula had a units error):**
  `var_raw = n·(s²_x + (1−maturity_frac)²·v̄_pred) / spend_c²` where `s²_x` = per-sub blended-value sample variance with **`s²_x = 0` when n ≤ 1**, `v̄_pred` = mean per-sub predictive variance;
  `var_post = (1−w)²·var_raw + w²·var_post_parent` (n=0 ⇒ parent's; floored at `var_prior_floor`);
  80% interval = `ltv_shrunk ± 1.2816·√var_post`. UI label: **"80% uncertainty range."** validate() asserts every CI is finite; a unit test pins the flip cell's CI half-width.
- **Decomposition — two families, mirroring the two-part model (matured cohorts only):**
  (i) **value**: ridge on `asinh(rev)` over *buyers only*, one-hot dims, centered within dim → `effect_value_usd` (recovers planted `log m_ltv`; the v1.0 all-subs version could outright fail corr ≥ 0.8 because it mixes conversion and value margins — confirmed);
  (ii) **conversion**: the IRLS logistic's dim coefficients → `effect_conv` (log-odds; lands on the `log m_feconv` scale).
  Tornado headline = value family (hype-10x correctly negative); optional paired conversion bar visualizes the flip mechanism per-dimension ("hype makes people buy once; it doesn't make them worth anything").
- **UNTAPPED imputation (per-subscriber units, ×/÷ verified):** `imputed_ltv_per_dollar = composed_per_sub_LTV / (CAC0 · m̂_cac)` where composed LTV = baseline × Π value-effects down the path, and `m̂_cac = mean(sibling cpl_c)/CAC0` over siblings sharing the path minus one dim (CPL is the correct denominator — effects are per-subscriber including zeros; do NOT divide by p̂). Candidates = cube rows with `0 < spend < p20 within-grain` at campaign-or-deeper grains (zero-spend rows don't exist in a grouped cube). Requires ≥2 siblings with n ≥ 30.

### 7.5 `verdicts.ts` — decision engine (all constants in config)
H=1.0 · margin=0.15 · n_floor=30 · conf_floor=0.6 · maturity_floor=0.25 · untapped_mult=1.3 · spend floors = quantiles **within grain** over nonzero-spend rows (material = p50, high = p75, starved = p20) · `spend_day = last_week_spend_c / 7`.
- **Precedence (first match wins): KILL → TRIM → SCALE → UNTAPPED → WATCH.**
  KILL: `ci_high < H ∧ n ≥ n_floor ∧ spend_day ≥ p50` · TRIM: `ltv_shrunk < H ≤ ci_high ∧ n ≥ n_floor ∧ spend_day ≥ p75` · SCALE: `ci_low > H+margin ∧ n ≥ n_floor` · UNTAPPED: `imputed ≥ H·untapped_mult ∧ spend_day < p20 ∧ sibling support` · else WATCH.
- **Engine-level forcing (so MCP and UI can never disagree — confirmed):** if `confidence < conf_floor ∨ maturity_frac < maturity_floor` ⇒ `verdict = WATCH`, raw verdict stored in `leaning`, `is_flip` suppressed (leaning-flip shown as tooltip only). `confidence = clamp01(0.5·min(1, n/n_floor) + 0.3·maturity_frac + 0.2·(1 − shrink_weight))` — formula pinned here, echoed in meta.json.
- **$ impact/day:** KILL/TRIM (bleed, measured): `spend_day · (1 − ltv_shrunk)` clamped ≥ 0 · SCALE (upside): `spend_day · (ltv_shrunk − H)` capped at `spend_day` · UNTAPPED (upside): `median sibling spend_day · (imputed − H)` · WATCH: 0. Upside rows carry `estimate_basis: "marginal_cac_naive"` and the hedge renders on the card face.
- **Brief assembly (greedy, leaf-disjoint — kills the double-count):** candidates = actionable rows (`verdict ≠ WATCH`) from all grains, ranked by `|impact|·confidence`; accept a candidate only if its covered leaf-set (leaves matching its pinned dims) is disjoint from already-accepted coverage; fold skipped overlaps into the accepted card's `also_visible_at`. `headline_bleed_c` = Σ accepted KILL/TRIM; `headline_upside_c` = Σ accepted SCALE/UNTAPPED. Leaves partition spend ⇒ bleed ≤ spend/day by construction.

### 7.6 `validate.ts` — split gates (confirmed: don't let stats tuning block the pipeline)
**validate:core (hard gate from first artifact commit):**
1. FLIP row exists at story-5 grain under its expected cell_key; sidecar true ltv:cac < 1.0; **platform_roas ∈ [1.8, 2.8]**; final verdict ∈ {KILL, TRIM} with `is_flip` (or leaning-flip if young — must NOT be young at snapshot; assert not forced-WATCH).
2. UNTAPPED row exists under its expected key; spend within-grain < p20; **imputed ltv:cac ∈ [3.5, 6.5]** (catches the ×/÷ inversion, which yields ~11.9); verdict = UNTAPPED.
3. Sparsity: ≥60% of leaf cells n ≤ 5. 4. Referential integrity: every parent_key resolves; every brief cell has cube + series entries; grain registry closure. 5. Brief non-degenerate: ≥4 verdict groups, `headline_bleed_c ≥ $1,000/day`, `headline_upside_c > 0`. 6. Every CI finite; no NaN anywhere (JSON.stringify round-trip check).
**validate:stats (warn-only until hard gate Jul 3 09:00):**
7. Recovery: corr(recovered value-effects, planted log m_ltv) ≥ 0.8 **over dim levels with n ≥ 50 subs** (population pinned — Zipf-tail campaign levels would mechanically fail); conversion-family corr ≥ 0.8 same population; negative control |corr| ≤ 0.2.
8. Shrunk-beats-raw MAE on held-out thin cells. 9. Calibration: Σpred/Σrealized ∈ [0.9, 1.1] overall AND per stratum (out-of-sample).

### 7.7 `query.ts` — the shared contract
`queryCells(q)`, `getCell(key)`, `drillDown(key)` (`parent_key = key`), `findUntapped()`, `dailyBrief()`, `listFlips(minImpact)` — pure functions over loaded artifacts; grain validation per §6.4; **both** `/api/*` and MCP tools call these. `min_confidence` gates *ranking* surfaces only; UNTAPPED/WATCH-specific surfaces pass explicit lower gates so the money shot can't be filtered into an empty screen.

## 8. API contract (route handlers, all GET, read-only)
- `GET /api/cells?grain=story-5&…` → `{rows: CubeRow[], applied}` — 400 + `{error:"grain_not_available", requested, available_grains}` on bad grain; zod-reported param errors.
- `GET /api/cells/:key` → `{cell, series, effects_for_dims, children_preview, parent_chain}`; 404 JSON with story-cell links for unknown keys.
- `GET /api/brief` → `{headline_bleed_c, headline_upside_c, groups, snapshot_meta}`.
- Loader: `fs.readFile(path.join(process.cwd(), "data/artifacts", …))` + module cache (never `import.meta.url` path tricks). `next.config.ts`: `outputFileTracingIncludes: { "/**": ["./data/artifacts/**"], "/*": ["./data/artifacts/**"] }` (both key shapes for glob-matching safety). `/brief` exports `dynamic = "force-static"`. **M2 hard gate:** after `next build`, assert `.next/server/app/**/*.nft.json` traces include the artifacts, then verify `/cell/[key]` + `/explore` on the deployed URL before building on top.

## 9. MCP server (`/api/mcp`, `mcp-handler`, HTTP transport ONLY — no SSE, no Redis)
Route stays `src/app/api/mcp/route.ts` with `{ basePath: "/api" }`. **Day-0 spike (done/tonight): ship a `ping` tool on the hello-world deploy and verify from a real client; time-box 60 min; if mcp-handler wobbles, the guaranteed floor is a ~100-line hand-rolled JSON-RPC route** — a working MCP endpoint is P0, its absence is a P0 failure (the "REST-only" worst case is deleted).
Tools (zod schemas; thin wrappers over §7.7): `rank_cells` · `get_cell` · `explain_cell` (both effect families + verdict reason + "% borrowed") · `list_flips` · `find_untapped` · `daily_brief` · `draft_budget_change(changes[])` → structured reversible proposal + CSV string, never executes.
Resources: `methodology`, `thresholds` (+ grain registry), `glossary`.
README connect snippet — `claude mcp add --transport http ground-truth https://<demo>/api/mcp` first; `npx mcp-remote` for Claude Desktop as fallback. Judges interrogating the demo's own data from their Claude = the wow.

## 10. UI spec — with P0 acceptance floors (confirmed timeline fix; full detail still in UI-AND-DATA-DESIGN §1)
**Aesthetic:** financial-terminal-meets-Linear; dark default; tabular-nums; verdict colors (SCALE green · KILL red · TRIM amber · WATCH slate · UNTAPPED blue · FLIP warning diamond); one display serif for the two headline dollar figures. `frontend-design` + `dataviz` skills at build time. This spec's compressed component list is **authoritative** over the UI doc where they differ.
1. `/brief` — **P0:** portfolio strip (Spend 18w · True MER vs Platform MER · headline bleed + upside tiles · verdict counts); verdict-grouped cards **including the UNTAPPED group** (it's the same card component — money shot #2 must not be cuttable); card = badge (+leaning tooltip) · path · bullet bar + uncertainty whisker vs 1×/2×/3× · platform→truth dumbbell · $/day (+basis hedge) · maturity badge ("n=412 · 38d · 18% borrowed"). **No Add-to-Proposal CTA unless the cart ships (P1 unit: cart + CTAs + draft_budget_change together; if cut, hide all three).**
2. `/explore` — **P0:** dense sortable table (path, verdict, spend, CPL, CAC, platform ROAS, true LTV:CAC + range, payback_day, **$ impact/day**, maturity) · grain **preset select** (registry names incl. "Story cells") · filters hydrated from URL `searchParams` (Brief cards deep-link pre-filtered). **P1:** chip add/remove editor, decomposition side rail, treemap, quadrant. WATCH rows muted (presentation only — verdict already forced in engine).
3. `/cell/[key]` — **P0:** Flip Gauge (reuse Dumbbell + precomputed `reason`) · payback curve (Recharts line + CAC ReferenceLine; **no confidence cone — series carries no per-week CI; cut, don't fake**) · decomposition tornado (static bars from dim_effects, value family; conversion bars P1) · maturity/provenance panel. **P1:** calibration inset, click-bar-to-pivot.
- Overlays — **P0:** Methodology drawer (plain-English method glosses, thresholds, honest-synthetic disclosure, planted-story annotations; recovery *charts* P1 — the same proof ships in the README regardless). **P1:** Proposal cart slide-over (CSV / copy-to-Slack).
- Persistent "⚗ Synthetic demo data" pill → Methodology. Next 16 note: `await props.searchParams`/`params` everywhere.

## 11. Quality gates & testing
- **Engine (vitest):** existing 29 + per new module: DGP invariants (censoring, whale gating+cap, OTO only on first_purchase); GLM recovery on toy fixture; EB limits (n→∞ raw, n→0 parent); CI finiteness + flip half-width pin; verdict truth-table incl. forcing/leaning cases (`ci_high<H, conf 0.3 ⇒ WATCH + leaning KILL`); grain closure; brief disjointness (`Σ card leaves ≤ total leaves`, no double-count fixture); **truth-import graph test**; query contract semantics (grain validation, filter, gates); cell_key stability fixture.
- **Pre-commit:** `npm run lint` (verify flat config actually lints) + `tsc --noEmit` + `npm test`; no console.log; no secrets (none exist).
- **Lighthouse: advisory only, run once at M2 first deploy; fix cheap wins (contrast tokens for slate-on-dark WATCH rows), then stop.** This consciously waives the global CLAUDE.md 90+ gate for this contest — rubric says "ugly and functional beats beautiful and broken"; the waiver is recorded in AGENTS.md so the gate doesn't re-impose itself on submission day.
- **Pre-submit (Jul 4):** validate:core + validate:stats green in meta.json · all routes + drawer on the live URL cold · MCP answers `daily_brief` from a fresh client · clean-clone `npm i && npm run generate && npm test && npm run dev` quickstart verified.

## 12. Deployment
Vercel Hobby, project `ground-truth` (live since Jul 1). No env vars, no external services; artifacts baked into the deploy. Deploy at least daily; prod = `main`.

## 13. README & submission (co-heaviest rubric axis — a running thread, not an M4 item)
- **Tonight/M1 (zero-code sections):** "Why this?" (their economics in their language; the attribution-window mechanism; permission to outbid) · Architecture (mermaid; snapshot-artifact contract; production rail: `/c` click-id redirect + postback, DuckDB→Postgres, LightGBM upgrade) · Cost model (tokens are a rounding error; the bill is the join) · **What's next — the three-beat ITM integration story, sourced ONLY from their public /role page (never internal tool names):** (1) verdicts become tool calls into their announced "automated ad creation and upload workflow via MCP server" — Ground Truth proposes via `draft_budget_change`, their MCP executes behind caps/confirm/rollback/audit; (2) their announced landing-page generator/CMS stamps cell provenance at page-mint time, making the back-end join free; (3) their email/SMS engagement streams become the day-3–7 early-behavior features this model already consumes. Close with "permission to outbid."
- **M1:** honest-synthetic disclosure (hierarchy, multiplier tables, planted stories, validate() invariants) + recovery charts from recovery.json. **Framing (confirmed):** never claim "the model rediscovers the DGP" — claim *"the pipeline is scored against ground truth it never reads (import-graph-tested), under structure the model can't represent: whale gating, zero-inflation, refund dynamics, Pareto tails, censoring — recovery validates pipeline correctness, not model-family choice,"* plus the permuted-key negative control.
- **M4 only:** screenshots, MCP connect snippet, clean-clone quickstart run.
- **Video:** rough end-to-end take at Jul 3 freeze (backup); polished take Jul 4 is optional insurance. Submit-ready 15:00 ET; 18:00–23:59 = untouched emergency buffer.

## 14. Timeline & scope tiers
| Milestone | Target | Contents |
|---|---|---|
| **M0 ✓ (+tonight)** | Jul 1 | ✓ scaffold, deps, vitest, private repo, prod deploy, rand/dims/fit modules (29 tests). **Remaining tonight: MCP ping spike on the live deploy + README zero-code draft + config.ts/types.ts (grain registry + parent table + thresholds)** |
| **M1 — engine** | Jul 2 midday | dgp/ + model/ltv,shrink,decompose + cube + verdicts + validate:core green + artifacts committed (naive-predictor stopgap allowed to unblock M2: `pred = realized/max(maturity,0.25)` schema-identical) + validate:stats warn-report |
| **M2 — spine** | Jul 2 night | query.ts + APIs + tracing hard-gate on deployed URL + Brief + Explorer (P0 floors) + one-time Lighthouse advisory pass |
| **M3 — proof** | Jul 3 | Cell Detail + Methodology drawer + MCP tools wired + validate:stats hard gate (09:00) + P1 in cut-order + polish + **rough backup video at freeze** |
| **M4 — ship** | Jul 4 ≤15:00 ET | README finish (screenshots, quickstart verify), pre-submit checklist, Konner records polished video, **submit** |

**P0 (must):** engine + validate:core + artifacts · APIs + grain errors · Brief (incl. UNTAPPED group, both headline numbers) · Explorer (P0 floor) · Cell Detail (P0 floor) · Methodology drawer (text) · MCP endpoint + {rank_cells, get_cell, explain_cell, list_flips, daily_brief} · README · live deploy.
**P1 (cut bottom-up — cart is cut LAST, treemap FIRST):** ① Proposal-cart unit (cart + CTAs + draft_budget_change + find_untapped tool) ② validate:stats extras + recovery charts in-app ③ sparklines (needs `spend_wk_c[]` in series) ④ calibration inset ⑤ conversion-family tornado bars ⑥ keyboard nav ⑦ CI regen check ⑧ decomposition side rail ⑨ quadrant ⑩ treemap.
**P2:** embedded chat panel · illustrative `/c`+`/postback` endpoints · real-data CSV blend · predictive-power-vs-N panel.

## 15. Risks (v1.1)
| # | Risk | Mitigation |
|---|---|---|
| 1 | ~3-day squeeze; M1 slip cascades | Engine has zero UI deps; naive-predictor stopgap unblocks M2 on schema-identical artifacts; P0 floors pre-agreed; README runs as a thread from tonight |
| 2 | TS statistics quietly wrong | Exact formulas pinned in spec (§7.3); property tests with known answers; validate:stats is an end-to-end statistical test; two-family decomposition verified by simulation in review (corr ≈ 0.998 vs 0.39–0.76 for the v1.0 design) |
| 3 | MCP friction | Spike moved to Day 0 on the live deploy; floor = hand-rolled JSON-RPC (~100 lines); working MCP is P0 |
| 4 | Artifact size vs serverless | Budget ≤ 20 MB; per-grain split ready behind the loader; measure at M1 |
| 5 | Chart-lib jank | Recharts only where earned (payback, tornado); bullet/dumbbell/meter are hand-rolled divs/SVG; no charts in table rows at P0 |
| 6 | Judging-day fragility | No DB/env/external APIs; force-static /brief; friendly unknown-key/grain errors; tracing hard-gate at M2; cold-URL checklist |
| 7 | Synthetic reads as toy | Transparency-as-product + recovery proof with negative control + import-graph test cited in README; production rail documented with real API specifics |
| 8 | Windows dev quirks | .gitattributes eol policy; deterministic snapshot_at; no shell-dependent scripts (tsx everywhere) |

## 16. Resolved questions (v1.0 §16 → answers)
1. Artifacts committed ✓ (deterministic; CI regen check is P1). 2. GLM+EB construction fixed per §7.3 (units, calibration, censoring) — survives a technical judge and stays explainable. 3. P0 line redrawn with per-component floors; confidence cone cut; UNTAPPED group promoted. 4. mcp-handler ✓ on Vercel with basePath + HTTP transport; spike Day 0; JSON-RPC floor. 5. UNTAPPED imputation formula corrected (÷ not ×; CPL denominator; within-grain starved set) + value-range assert. 6. Headline split bleed/upside + leaf-disjoint dedup — survives the media-buyer BS-check.
