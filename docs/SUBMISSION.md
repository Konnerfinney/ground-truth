# Submission run-of-show — July 4 (hard close 23:59 ET)

**Targets: submit-ready by 15:00 ET · submitted by 18:00 ET · 18:00–23:59 untouched emergency buffer.**

## What you submit

| Field | Value |
|---|---|
| Live demo | **https://ground-truth-brown.vercel.app** (the `-brown` alias ONLY — hash/team URLs are auth-walled) |
| Repo | https://github.com/Konnerfinney/ground-truth — **currently PRIVATE: flip to public, or invite the judges, per the form's instructions** (everything in it is synthetic; safe either way) |
| README | in the repo root — the scored write-up ("Why this?" / "What's next?" included) |
| Video | record per `docs/DEMO-SCRIPT.md` (~2.5 min, 4 beats, narration written out) |

## Morning of (≤30 min, in order)

1. **Repo visibility** — flip public (Settings → General → Danger Zone → Change visibility) or add judge accounts as read collaborators. Verify logged-out: open the repo URL in a private browser window; confirm the README renders with its three screenshots.
2. **Cold-URL sweep** (private browser window, phone too if you like — it's responsive):
   `/brief` → `/explore?grain=story-5&sort=flip_divergence` → `/cell/cz238xa1fhfu27` → `/methodology` → `/proposal` → `/connectors`.
3. **MCP check** — in Claude Code:
   `claude mcp add --transport http ground-truth https://ground-truth-brown.vercel.app/api/mcp`
   then ask for the daily brief. (Also needed for video beat 4.)
4. **Record** — script in `docs/DEMO-SCRIPT.md`. One rough full take FIRST, then retakes per beat if wanted. The live URL is the primary deliverable; the video is support — don't let polish threaten the clock.
5. **Submit the form.** Screenshot the confirmation.

## If something looks broken

- Do NOT redeploy reflexively. The deploy is immutable and was verified; check whether it's your network/browser first.
- Rollback exists: Vercel dashboard → Deployments → promote the previous Ready deployment.
- Nothing in the demo depends on a database, an API, or credentials — there is no expiry-shaped failure mode.

## Numbers you might be asked about (all live on /methodology)

- Bleeding **$1,207/day** + **$7,071/day** upside across 24 deduplicated moves; 5 flips among them
- THE FLIP: pixel **2.08×** vs true **0.53×** (sidecar 0.38); payback: crosses day 1, refunds claw it back — **never**
- THE UNTAPPED: **~$383** total spend, imputed **5.3×** LTV per dollar
- Portfolio: pixel **0.8×** vs 90-day truth **2.0×**
- Recovery **0.89 / 0.95**, negative control **0.15**, calibration **1.07** — with both scoring disclosures shipped in the artifacts
- **126 tests**, including row-identical Postgres↔memory parity; artifacts regenerate byte-identically from seed `20260704`

## Post-submission (whenever)

Light up the optional-on layers on a non-judged deployment: `DATABASE_URL` (Supabase — remember `db:load`), `META_*` (connector goes live that night), `GOOGLE_OAUTH_*` + `AUTH_SECRET` (sign-in appears). Roadmap: `docs/CONNECTORS.md`.
