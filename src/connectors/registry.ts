import { metaAdapter } from "./meta";
import type { ConnectorStatus, SourceAdapter } from "./types";

/**
 * Connector registry — configuration is environment secrets per deployment
 * (12-factor). A connector is live the moment its variables exist; nothing
 * else changes. Multi-workspace credential storage (encrypted vault behind
 * real auth) is the documented post-contest step — see docs/CONNECTORS.md.
 */

const API_CONNECTORS = [
  {
    platform: "meta",
    needs: ["META_ACCESS_TOKEN", "META_AD_ACCOUNT_ID"],
    build: (): SourceAdapter =>
      metaAdapter({
        accessToken: process.env.META_ACCESS_TOKEN!,
        adAccountId: process.env.META_AD_ACCOUNT_ID!,
      }),
  },
  // API adapters for these ship after the contest; the CSV adapter covers
  // them today (same normalized output, so nothing downstream changes).
  { platform: "google", needs: ["GOOGLE_ADS_DEVELOPER_TOKEN", "GOOGLE_ADS_REFRESH_TOKEN", "GOOGLE_ADS_CUSTOMER_ID"], build: null },
  { platform: "tiktok", needs: ["TIKTOK_ACCESS_TOKEN", "TIKTOK_ADVERTISER_ID"], build: null },
  { platform: "taboola", needs: ["TABOOLA_CLIENT_ID", "TABOOLA_CLIENT_SECRET", "TABOOLA_ACCOUNT_ID"], build: null },
] as const;

export function connectorStatuses(): ConnectorStatus[] {
  const statuses: ConnectorStatus[] = API_CONNECTORS.map((c) => {
    const configured = c.needs.every((k) => Boolean(process.env[k]));
    return configured && c.build
      ? { platform: c.platform, kind: "api", configured: true }
      : { platform: c.platform, kind: "api", configured: false, needs: [...c.needs] };
  });
  statuses.push({
    platform: "csv",
    kind: "csv",
    configured: true,
    note: "any platform's export, normalized through the same contract — live on day one",
  });
  return statuses;
}

/** Adapters that are actually runnable right now. */
export function configuredAdapters(): SourceAdapter[] {
  const out: SourceAdapter[] = [];
  for (const c of API_CONNECTORS) {
    if (c.build && c.needs.every((k) => Boolean(process.env[k]))) out.push(c.build());
  }
  return out;
}
