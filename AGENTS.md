<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# Ground Truth — project instructions

## Overview & context
Entry for It's Today Media's $5,000 Build Challenge (hiring contest, submission closes **2026-07-04 23:59 ET**). A read-only "profit-truth" engine for FinPub media buying: attributes back-end 90-day subscriber LTV to granular acquisition cells, predicts LTV early, shrinks thin cells toward hierarchy parents, and emits confidence-gated SCALE/KILL/TRIM/WATCH/UNTAPPED verdicts — headlined by "the flip" (platform-ROAS winners that are real-payback losers). **All data is synthetic** from a seeded, documented DGP; transparency about that is the pitch. Canonical spec: `docs/SPEC.md`. Judged on Problem Selection, Functionality, Code Quality, README.

## Tech stack
- Next.js 16 (App Router, RSC-first), TypeScript **strict**, Tailwind v4, shadcn/ui, Recharts 3, lucide-react.
- Pure-TS data engine in `src/engine/` (zero Next imports — unit-testable): seeded DGP (`pure-rand`), two-part GLM, empirical-Bayes shrinkage, ridge decomposition, curated-grain cube, verdict engine, `validate()` gate.
- Snapshot artifacts in `data/artifacts/*.json` (committed, regenerable via `npm run generate`); served via `fs` + module cache; `outputFileTracingIncludes` bundles them on Vercel.
- MCP server at `/api/mcp` via `mcp-handler` (read-only tools; zod schemas).
- The judged deployment runs with ZERO env vars (no database, no services, no auth). Postgres serving (`DATABASE_URL`), ad-platform connectors (`META_*`), and Google OIDC auth (`GOOGLE_OAUTH_*` + `AUTH_SECRET`) are optional-on: each activates only when its env exists. Never make a core surface depend on any of them.

## Commands
- `npm run dev` · `npm run build` · `npm run lint` · `npm run typecheck` · `npm test` (vitest) · `npm run generate` (rebuild artifacts from seed).

## Quality gates (before every commit)
`npm run lint` + `npm run typecheck` + `npm test` clean; no `console.log` in committed code; no secrets (none should ever exist here). `validate()` must pass before artifacts are committed.

## Deployment
Vercel (project `ground-truth`), production = `main`. Artifacts ship with the repo — deploys are immutable and self-contained.

## Constraints
- **Read-only mandate:** the tool never writes to ad platforms; proposals are drafts/CSV only. MCP tools must never claim to execute.
- **The agent narrates, never computes:** UI and MCP both call `src/engine/query.ts` — one shared query contract. No LLM math.
- **Money is integer cents** internally; format at the edge.
- **Dimension bit positions are frozen** (see `docs/SPEC.md` §6.1); never reorder.
- All synthetic data is tagged `source: "synthetic"`; never present it as real.
- Commit small and often; push to `origin main` (private repo).
