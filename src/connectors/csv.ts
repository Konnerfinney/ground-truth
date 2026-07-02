import { parseNameHierarchy } from "./naming";
import type { NormalizedSpendRow, SourceAdapter } from "./types";

/**
 * The universal fallback: every ad platform exports CSV. This adapter turns
 * a standard export into normalized rows, so a new channel is live the day
 * you start buying on it — the API connector is an upgrade, not a
 * prerequisite. Expected headers (case-insensitive; extras ignored):
 *
 *   date, campaign, adset, ad, spend, impressions, clicks
 *   [optional: platform, account, placement, device, geo]
 */

const REQUIRED = ["date", "campaign", "adset", "ad", "spend"] as const;

/** Minimal RFC-4180 CSV parse (quoted fields, escaped quotes, CRLF). */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let field = "";
  let row: string[] = [];
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else inQuotes = false;
      } else field += ch;
    } else if (ch === '"') inQuotes = true;
    else if (ch === ",") {
      row.push(field);
      field = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(field);
      field = "";
      if (row.length > 1 || row[0] !== "") rows.push(row);
      row = [];
    } else field += ch;
  }
  if (field !== "" || row.length > 0) {
    row.push(field);
    if (row.length > 1 || row[0] !== "") rows.push(row);
  }
  return rows;
}

export function csvToSpendRows(text: string, defaults: { platform: string; account?: string }): NormalizedSpendRow[] {
  const grid = parseCsv(text.trim());
  if (grid.length < 2) return [];
  const header = grid[0].map((h) => h.trim().toLowerCase());
  const col = (name: string) => header.indexOf(name);
  for (const req of REQUIRED) {
    if (col(req) < 0) throw new Error(`csv adapter: missing required column "${req}"`);
  }
  const get = (r: string[], name: string, fallback = "") => {
    const i = col(name);
    return i >= 0 ? (r[i] ?? "").trim() : fallback;
  };
  return grid.slice(1).map((r) => {
    const campaign = get(r, "campaign");
    const adset = get(r, "adset");
    const ad = get(r, "ad");
    return {
      date: get(r, "date"),
      platform: get(r, "platform", defaults.platform) || defaults.platform,
      ad_account_id: get(r, "account", defaults.account ?? "csv") || "csv",
      campaign_id: campaign,
      campaign_name: campaign,
      adset_id: adset,
      adset_name: adset,
      ad_id: ad,
      ad_name: ad,
      placement: get(r, "placement", "all") || "all",
      device: get(r, "device", "all") || "all",
      geo: get(r, "geo", "all") || "all",
      spend_c: Math.round(parseFloat(get(r, "spend", "0") || "0") * 100),
      impressions: parseInt(get(r, "impressions", "0") || "0", 10),
      clicks: parseInt(get(r, "clicks", "0") || "0", 10),
      ...parseNameHierarchy(campaign, adset, ad),
    };
  });
}

export function csvAdapter(platform: string, getText: (date: string) => Promise<string | null>): SourceAdapter {
  return {
    platform,
    async fetchSpend(date: string): Promise<NormalizedSpendRow[]> {
      const text = await getText(date);
      if (!text) return [];
      return csvToSpendRows(text, { platform }).filter((r) => r.date === date);
    },
  };
}
