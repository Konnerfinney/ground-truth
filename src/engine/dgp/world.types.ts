import type { DimName } from "../dims";

/**
 * Internal DGP contract (SPEC §7.2) — shared by dgp/ (producer) and
 * model/ + cube.ts (consumers). Money in integer cents; days are
 * days-since-acquisition unless noted.
 */

/** A fully-specified acquisition cell: all 10 dims pinned. */
export type FullDims = Record<DimName, string>;

/** Spend fact at the DGP's native grain: full cell × cohort week. */
export interface SpendCellWeek {
  dims: FullDims; // dims.cohort_week === week
  week: string; // ISO cohort week, e.g. "2026-W14"
  spend_c: number;
  optins: number; // subscribers acquired (Poisson-drawn)
  /** Gross purchase revenue with day ≤ 7, × over-attribution. Refunds NEVER subtracted. */
  plat_conv_value_c: number;
}

export type RevType =
  | "fe_sale" // front-end sale d0–3 (in platform window)
  | "oto" // impulse one-time-offer d0–2 (the flip mechanic)
  | "core_sale" // d3–30
  | "affiliate" // commission d5–90
  | "renewal" // monthly, survival process
  | "managed_money" // whale d20–90, Pareto, winsorized, whale-eligible audiences only
  | "refund"; // d3–30, negative amount

export interface RevEvent {
  day: number; // days since acquisition, 0..90
  type: RevType;
  amount_c: number; // negative for refunds
}

export interface Subscriber {
  id: number;
  dims: FullDims;
  cohort_week: string; // === dims.cohort_week
  age_days: number; // at snapshot; ≥ 91 ⇒ fully mature
  z: number; // latent quality (diagnostics only — never a model feature)
  // Early behaviors (first 7 days) — THE model features:
  opens_7d: number;
  clicks_7d: number;
  sms_optin: boolean;
  first_purchase: boolean;
  /** FULL 90-day event stream (uncensored). Consumers must censor at age_days. */
  events: RevEvent[];
}

/** Sum of event amounts with day ≤ min(ageDays, 90). */
export function realizedAt(sub: Subscriber, ageDays: number): number {
  let s = 0;
  for (const e of sub.events) if (e.day <= Math.min(ageDays, 90)) s += e.amount_c;
  return s;
}

/** True (uncensored) 90-day LTV — validation sidecar use ONLY. */
export function trueLtv90(sub: Subscriber): number {
  return realizedAt(sub, 90);
}

/** A subscriber "bought" if any positive purchase event exists within age. */
export function isBuyerAt(sub: Subscriber, ageDays: number): boolean {
  return sub.events.some((e) => e.day <= Math.min(ageDays, 90) && e.amount_c > 0);
}

/** Planted multiplier tables — the answer key (truth_effects.json sidecar). */
export interface TruthEffects {
  /** per dim → per level → multipliers (absent level ⇒ 1.0) */
  m: Partial<Record<DimName, Record<string, LevelEffects>>>;
  campaign_propensity: Record<string, number>; // Zipf weights by campaign id
}

export interface LevelEffects {
  m_cac: number;
  m_feconv: number; // front-end punch (drives platform ROAS + OTO take-rate)
  m_ltv: number; // back-end 90d value
  m_refund: number;
}

export interface World {
  spend: SpendCellWeek[];
  subs: Subscriber[];
  truth: TruthEffects;
}
