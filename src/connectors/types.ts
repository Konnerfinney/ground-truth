/**
 * Connector layer (production ingestion, stream 1: spend).
 *
 * Every connector — API or CSV — normalizes to the same fact the engine
 * consumes. Semantic dimensions (audience, creative angle, offer) come from
 * the naming convention parser; delivered dimensions (placement, device)
 * come from platform breakdowns; geo/device truth ultimately comes from the
 * /c click rail at subscriber level, so adapters may emit "all".
 */

export interface NormalizedSpendRow {
  date: string; // YYYY-MM-DD
  platform: string; // our vocab: meta, google, tiktok, taboola, …
  ad_account_id: string;
  campaign_id: string;
  campaign_name: string;
  adset_id: string;
  adset_name: string;
  ad_id: string;
  ad_name: string;
  placement: string; // our vocab (fb-feed, reels, …) or "all"
  device: string; // desktop | mobile | tablet | all
  geo: string; // ISO-ish or "all"
  spend_c: number; // integer cents
  impressions: number;
  clicks: number;
  /** Parsed from names via the naming convention; null when absent. */
  audience: string | null;
  creative: string | null;
  offer: string | null;
}

export interface SyncResult {
  platform: string;
  date: string;
  rows: number;
  spend_c: number;
  warnings: string[];
}

export interface SourceAdapter {
  platform: string;
  /** Pull one day of ad-level spend, normalized. */
  fetchSpend(date: string): Promise<NormalizedSpendRow[]>;
}

export type ConnectorStatus =
  | { platform: string; kind: "api"; configured: true }
  | { platform: string; kind: "api"; configured: false; needs: string[] }
  | { platform: string; kind: "csv"; configured: true; note: string };
