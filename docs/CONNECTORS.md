# Connectors — setup & roadmap

Spend ingestion is **environment-secrets-per-deployment** (12-factor): a connector goes live the
moment its variables exist. Status is always visible at [`/connectors`](https://ground-truth-brown.vercel.app/connectors);
the nightly sync (`vercel.json` cron → `/api/cron/sync`, 07:00 UTC) pulls yesterday for every
configured connector, lands normalized rows in `raw_spend` (Postgres), and records a `sync_runs`
row. Manual backfill: `GET /api/cron/sync?date=YYYY-MM-DD` (send `Authorization: Bearer $CRON_SECRET` if set).

## Meta (live adapter — Marketing API v25.0)

1. Business Settings → System Users → create (Admin not required; Employee + ad-account access works).
2. Assign the ad account with **Read** access; generate a token with the `ads_read` scope. System-user
   tokens on your own Business Manager require **no app review** and don't expire like user tokens.
3. Set env (locally in `.env.local`, on Vercel via project env vars):
   ```
   META_ACCESS_TOKEN=...
   META_AD_ACCOUNT_ID=act_1234567890
   DATABASE_URL=postgres://...        # where raw rows land
   CRON_SECRET=...                    # optional; Vercel sends it as a Bearer header
   ```
4. What it pulls: `level=ad`, daily, with the delivery-breakdown trio
   (`publisher_platform, platform_position, device_platform`) → our placement/device vocab.
   Geo is deliberately `all` — geo truth arrives per subscriber via the `/c` click rail, so we
   never allocate a country report across placements.
5. Ops you'll want before scale: re-pull a ~28-day trailing window nightly (Meta restates
   attribution); switch to the **async jobs** insights endpoint past a few thousand rows/day;
   alert on the `X-Business-Use-Case-Usage` rate header.

## Google Ads / TikTok / Taboola

API adapters are the next build (Google Ads GAQL reports; TikTok Marketing API reporting;
Taboola Backstage). **The CSV adapter covers all three today**: export with headers
`date, campaign, adset, ad, spend, impressions, clicks` (+ optional `placement, device, geo,
platform, account`) and it normalizes through the exact same contract — so a channel is live the
day you start buying on it, and the API is an upgrade, not a prerequisite.

## The naming convention (the connector nobody sells you)

Platform APIs report *delivered* dimensions, not *semantic* ones. Audience, angle and offer ride
on names, parsed by `src/connectors/naming.ts` (shared by API and CSV adapters):

```
Campaign: "Q3 Inflation | aud:crypto-curious | off:tw7"
Adset:    "LAL 3% | ang:hype-10x"
```

Order-free, case-free, `:` or `=`; most specific name wins (ad > adset > campaign). The sync
warns when rows arrive untagged, because untagged spend degrades the semantic dimensions for
everyone downstream.

## Roadmap: multi-workspace credentials (post-contest, deliberately)

The end state is users plugging credentials into the product itself. That requires, in order:

1. **Auth** — real accounts (Clerk or Supabase Auth; magic-link is enough), because a credential
   form without auth on a public URL is a vulnerability, not a feature.
2. **Encrypted vault** — `workspace_credentials` table, values sealed with AES-256-GCM under a
   key held only in the deployment env (envelope encryption; rotate by re-wrapping). Values are
   write-only through the UI: status shows *presence and last-used*, never the secret.
3. **Tenancy** — `workspace_id` on `raw_spend`/`sync_runs`/the cube; per-workspace nightly fan-out.
4. **Blast-radius discipline** — tokens requested at minimum scope (`ads_read`), stored per
   workspace, revocable from the platform side at any time, and never logged.

Until then, per-deployment env secrets give single-tenant deployments the full pipeline with the
smallest possible attack surface — which is also why the judged demo ships with none configured:
nothing to leak, nothing to expire, nothing to be down.
