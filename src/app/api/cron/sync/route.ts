import { NextRequest, NextResponse } from "next/server";
import { configuredAdapters } from "@/connectors/registry";
import type { NormalizedSpendRow, SyncResult } from "@/connectors/types";

/**
 * Nightly spend sync (vercel.json cron, 07:00 UTC). For each configured
 * connector: pull yesterday's ad-level spend, land it in the Postgres raw
 * store, record the run. With no connectors and/or no DATABASE_URL it
 * reports cleanly and exits — the demo runs in synthetic mode by design.
 *
 * Ops note baked in: Meta restates attribution for ~28 days, so a real
 * deployment re-pulls a trailing window; this route accepts ?date= for
 * manual backfills of any single day.
 */

export const maxDuration = 300;

const INGEST_DDL = `
CREATE TABLE IF NOT EXISTS raw_spend (
  date          date NOT NULL,
  platform      text NOT NULL,
  ad_account_id text NOT NULL,
  campaign_id   text NOT NULL,
  campaign_name text NOT NULL,
  adset_id      text NOT NULL,
  adset_name    text NOT NULL,
  ad_id         text NOT NULL,
  ad_name       text NOT NULL,
  placement     text NOT NULL,
  device        text NOT NULL,
  geo           text NOT NULL,
  spend_c       int NOT NULL,
  impressions   int NOT NULL,
  clicks        int NOT NULL,
  audience      text,
  creative      text,
  offer         text,
  synced_at     timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (date, platform, ad_id, placement, device, geo)
);
CREATE TABLE IF NOT EXISTS sync_runs (
  id        serial PRIMARY KEY,
  ran_at    timestamptz NOT NULL DEFAULT now(),
  date      date NOT NULL,
  platform  text NOT NULL,
  rows      int NOT NULL,
  spend_c   int NOT NULL,
  warnings  jsonb NOT NULL DEFAULT '[]'
);
`;

export async function GET(req: NextRequest) {
  // Vercel Cron sends Authorization: Bearer <CRON_SECRET> when set.
  const secret = process.env.CRON_SECRET;
  if (secret && req.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const adapters = configuredAdapters();
  const date = req.nextUrl.searchParams.get("date") ?? isoDaysAgo(1);

  if (adapters.length === 0) {
    return NextResponse.json({
      mode: "synthetic",
      note: "No ad-platform credentials configured — the demo serves the documented synthetic world. Set META_ACCESS_TOKEN + META_AD_ACCOUNT_ID (see /connectors) to go live.",
      date,
    });
  }
  const url = process.env.DATABASE_URL;
  if (!url) {
    return NextResponse.json(
      { error: "connectors are configured but DATABASE_URL is not — nowhere to land the rows" },
      { status: 500 },
    );
  }

  const { default: postgres } = await import("postgres");
  const sql = postgres(url, { max: 1, prepare: false });
  try {
    for (const stmt of INGEST_DDL.split(";")) {
      if (stmt.trim()) await sql.unsafe(stmt);
    }
    const results: SyncResult[] = [];
    for (const adapter of adapters) {
      const warnings: string[] = [];
      let rows: NormalizedSpendRow[] = [];
      try {
        rows = await adapter.fetchSpend(date);
      } catch (e) {
        warnings.push(String(e).slice(0, 500));
      }
      const unnamed = rows.filter((r) => !r.audience && !r.creative).length;
      if (unnamed > 0) {
        warnings.push(
          `${unnamed}/${rows.length} rows carry no naming-convention tags (aud:/ang:/off:) — semantic dimensions will be sparse until names are tagged`,
        );
      }
      for (let i = 0; i < rows.length; i += 500) {
        const chunk = rows.slice(i, i + 500);
        await sql.unsafe(
          `INSERT INTO raw_spend (date, platform, ad_account_id, campaign_id, campaign_name, adset_id, adset_name, ad_id, ad_name, placement, device, geo, spend_c, impressions, clicks, audience, creative, offer)
           SELECT x.date, x.platform, x.ad_account_id, x.campaign_id, x.campaign_name, x.adset_id, x.adset_name, x.ad_id, x.ad_name, x.placement, x.device, x.geo, x.spend_c, x.impressions, x.clicks, x.audience, x.creative, x.offer
           FROM jsonb_to_recordset($1::jsonb) AS x(date date, platform text, ad_account_id text, campaign_id text, campaign_name text, adset_id text, adset_name text, ad_id text, ad_name text, placement text, device text, geo text, spend_c int, impressions int, clicks int, audience text, creative text, offer text)
           ON CONFLICT (date, platform, ad_id, placement, device, geo) DO UPDATE SET
             spend_c = EXCLUDED.spend_c, impressions = EXCLUDED.impressions, clicks = EXCLUDED.clicks,
             audience = EXCLUDED.audience, creative = EXCLUDED.creative, offer = EXCLUDED.offer, synced_at = now()`,
          [JSON.stringify(chunk)],
        );
      }
      const spend_c = rows.reduce((a, r) => a + r.spend_c, 0);
      await sql.unsafe(
        "INSERT INTO sync_runs (date, platform, rows, spend_c, warnings) VALUES ($1, $2, $3, $4, $5::jsonb)",
        [date, adapter.platform, rows.length, spend_c, JSON.stringify(warnings)],
      );
      results.push({ platform: adapter.platform, date, rows: rows.length, spend_c, warnings });
    }
    return NextResponse.json({ mode: "live", date, results });
  } finally {
    await sql.end();
  }
}

function isoDaysAgo(n: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - n);
  return d.toISOString().slice(0, 10);
}
