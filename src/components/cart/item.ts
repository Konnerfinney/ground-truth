import type { CubeRow } from "@/engine/types";
import { cellPath } from "@/lib/format";
import type { CartAction, CartItem } from "./CartClient";

/** Server-safe: derive the suggested draft action for a row's verdict. */
export function cartItemFor(row: CubeRow): CartItem | null {
  let action: CartAction;
  let delta: number | null;
  switch (row.verdict) {
    case "KILL":
      action = "pause";
      delta = null;
      break;
    case "TRIM":
      action = "decrease";
      delta = -30;
      break;
    case "SCALE":
      action = "increase";
      delta = 30;
      break;
    case "UNTAPPED":
      action = "test";
      delta = null;
      break;
    default:
      return null; // WATCH: not enough evidence to draft anything
  }
  const spendDay = Math.round(Math.max(row.last_week_spend_c / 7, row.spend_c / (7 * 18)) / 100);
  return {
    cell_key: row.cell_key,
    path: cellPath(row.dims),
    verdict: row.verdict,
    action,
    delta_pct: delta,
    spend_day_usd: spendDay,
    impact_day_usd: Math.round(row.dollar_impact_day_c / 100),
  };
}
