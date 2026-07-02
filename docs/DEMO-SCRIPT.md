# Demo script — ~2.5 minutes

> Recording notes: 1440×900 or larger, dark room-friendly (the app is dark),
> cursor visible. Live URL: https://ground-truth-brown.vercel.app
> Have one Claude window ready with the MCP server connected:
> `claude mcp add --transport http ground-truth https://ground-truth-brown.vercel.app/api/mcp`

## Beat 1 — the lie (Brief, ~40s)

Open **/brief**. Point at the portfolio strip:

> "This is a simulated financial-newsletter business — a million and a half in ad spend, seventy-one thousand subscribers. The pixel says this account runs at zero-point-eight ROAS. The 90-day back end says two-point-oh. The platforms aren't just missing the story — they're telling the wrong one."

Point at the headline:

> "So every morning this tool answers one question: what do I do today? Two numbers, never added together — bleed we can measure, upside we estimate and say so. Twenty-four moves, deduplicated so no two cards claim the same dollars."

Scroll to a ◆ FLIP card:

> "And this diamond is the money shot: a cell the platform reports as a winner that's actually losing money."

## Beat 2 — the proof (flip Cell Detail, ~50s)

Click the flip card (meta · crypto-curious · hype-10x · reels · mobile):

> "Meta reports two-point-one ROAS on this cell. The truth is fifty-three cents on the dollar — and here's the mechanism. Impulse buyers take a ninety-nine dollar one-time-offer inside the seven-day attribution window, so the pixel books it and looks brilliant."

Point at the payback curve:

> "Then watch the curve: it crosses cost on day one… and refunds claw it back. It never pays back. The platform never sees any of this — platforms don't see refunds, and they stopped watching after day seven anyway."

Point at the trait bars:

> "The decomposition even tells you which lever is to blame: the hype creative makes people buy once — it doesn't make them worth anything."

Click **+ draft pause**:

> "One click stages the fix. Drafts only — this tool never touches an ad platform."

## Beat 3 — the inverse + the trust (Explorer + Methodology, ~30s)

Open **Explorer → ★ Story cells**, sorted by Flip Δ:

> "Same machinery, opposite direction: retirement-education cells on newsletter placements photograph terribly in week one, so buyers starve them — the model composes their traits and flags them UNTAPPED at roughly five-to-one."

Click the ⚗ pill → methodology:

> "All of it is synthetic and it says so on every page — that's the point. The generator plants known effects, the pipeline never gets to read the answer key — there's a test asserting it can't import the file — and this page shows it recovered the planted effects at point-eight-nine anyway, with the negative control near zero."

## Beat 4 — the agent (Claude + MCP, ~30s)

Switch to Claude, ask: **"Give me the daily brief. Why is the biggest flip a KILL?"**

> "And because their team already runs on Claude and MCP: the same numbers, as tools. The agent narrates — it never computes. Ask it why, it cites the cell, the uncertainty range, and the evidence. Ask it to draft the changes and you get a reversible proposal with a CSV — never an execution."

Close:

> "Ground Truth: the back end, attributed to the cell that bought it, early enough to act on. That's permission to outbid."

## Fallbacks

- If MCP is slow on camera, pre-record that beat or show the `/proposal` export instead.
- Flip cell direct link: `/cell/cz238xa1fhfu27` · Untapped: check `data/artifacts/meta.json → untapped_cell_key`.
- Everything is static — no cold-start risk, no login, nothing to break.
