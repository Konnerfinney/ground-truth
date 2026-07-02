import { parseNameHierarchy } from "./naming";
import type { NormalizedSpendRow, SourceAdapter } from "./types";

/**
 * Meta Marketing API adapter — ad-level daily spend via the Insights
 * endpoint, pinned to v25.0 (current, Feb 2026).
 *
 * One call per day: level=ad with the delivery-breakdown trio
 * (publisher_platform × platform_position × device_platform). Geo stays
 * "all" by design — geo truth arrives at subscriber level via the /c click
 * rail, so we never have to allocate a country report across placements.
 *
 * Auth: a System User token on your own Business Manager (scope: ads_read)
 * needs no app review. Ops notes: attribution restates for ~28 days, so
 * nightly syncs re-pull a trailing window and upsert; watch the
 * X-Business-Use-Case-Usage header for rate budget; use the async jobs
 * endpoint if a single day exceeds a few thousand rows.
 */

export const META_API_VERSION = "v25.0";

export interface MetaConfig {
  accessToken: string;
  adAccountId: string; // "act_123…" or bare id
  apiVersion?: string;
}

interface MetaInsightsRow {
  date_start: string;
  account_id: string;
  campaign_id: string;
  campaign_name: string;
  adset_id: string;
  adset_name: string;
  ad_id: string;
  ad_name: string;
  spend: string; // Meta returns money as strings, in account currency units
  impressions: string;
  clicks: string;
  publisher_platform?: string;
  platform_position?: string;
  device_platform?: string;
}

export interface MetaInsightsResponse {
  data: MetaInsightsRow[];
  paging?: { next?: string };
}

/** publisher_platform × platform_position → our placement vocabulary. */
export function mapPlacement(publisher?: string, position?: string): string {
  const pub = (publisher ?? "").toLowerCase();
  const pos = (position ?? "").toLowerCase();
  if (pos.includes("reel")) return "reels";
  if (pos.includes("stor")) return "stories";
  if (pub === "facebook" && pos.includes("feed")) return "fb-feed";
  if (pub === "instagram" && pos.includes("feed")) return "ig-feed";
  if (pub === "audience_network") return "audience-network";
  if (pub === "messenger") return "messenger";
  if (pub && pos) return `${pub}-${pos}`;
  return "all";
}

export function mapDevice(devicePlatform?: string): string {
  const d = (devicePlatform ?? "").toLowerCase();
  if (d.includes("desktop")) return "desktop";
  if (d.includes("mobile")) return "mobile";
  if (d.includes("tablet")) return "tablet";
  return "all";
}

/** Pure and fixture-testable: one Insights page → normalized rows. */
export function parseInsightsPage(page: MetaInsightsResponse): NormalizedSpendRow[] {
  return page.data.map((r) => {
    const names = parseNameHierarchy(r.campaign_name ?? "", r.adset_name ?? "", r.ad_name ?? "");
    return {
      date: r.date_start,
      platform: "meta",
      ad_account_id: r.account_id,
      campaign_id: r.campaign_id,
      campaign_name: r.campaign_name ?? "",
      adset_id: r.adset_id,
      adset_name: r.adset_name ?? "",
      ad_id: r.ad_id,
      ad_name: r.ad_name ?? "",
      placement: mapPlacement(r.publisher_platform, r.platform_position),
      device: mapDevice(r.device_platform),
      geo: "all",
      spend_c: Math.round(parseFloat(r.spend || "0") * 100),
      impressions: parseInt(r.impressions || "0", 10),
      clicks: parseInt(r.clicks || "0", 10),
      ...names,
    };
  });
}

/** The token travels in an Authorization header, NEVER in the URL — URLs land
 * in logs, proxies and error messages; headers don't. */
export function insightsUrl(cfg: MetaConfig, date: string): string {
  const account = cfg.adAccountId.startsWith("act_") ? cfg.adAccountId : `act_${cfg.adAccountId}`;
  const params = new URLSearchParams({
    level: "ad",
    fields:
      "date_start,account_id,campaign_id,campaign_name,adset_id,adset_name,ad_id,ad_name,spend,impressions,clicks",
    breakdowns: "publisher_platform,platform_position,device_platform",
    time_range: JSON.stringify({ since: date, until: date }),
    time_increment: "1",
    limit: "500",
  });
  return `https://graph.facebook.com/${cfg.apiVersion ?? META_API_VERSION}/${account}/insights?${params}`;
}

/** Meta echoes request params into paging.next — strip any token before reuse. */
export function stripToken(url: string): string {
  const u = new URL(url);
  u.searchParams.delete("access_token");
  return u.toString();
}

export function metaAdapter(cfg: MetaConfig, fetchImpl: typeof fetch = fetch): SourceAdapter {
  const headers = { Authorization: `Bearer ${cfg.accessToken}` };
  return {
    platform: "meta",
    async fetchSpend(date: string): Promise<NormalizedSpendRow[]> {
      const rows: NormalizedSpendRow[] = [];
      let url: string | undefined = insightsUrl(cfg, date);
      let pages = 0;
      while (url && pages < 200) {
        const res = await fetchImpl(url, { headers });
        if (!res.ok) {
          const body = await res.text();
          throw new Error(`meta insights ${res.status}: ${body.slice(0, 300)}`);
        }
        const page = (await res.json()) as MetaInsightsResponse;
        rows.push(...parseInsightsPage(page));
        url = page.paging?.next ? stripToken(page.paging.next) : undefined;
        pages++;
      }
      return rows;
    },
  };
}
