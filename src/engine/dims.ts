import { fnv1a32 } from "./rand";

/**
 * The dimension registry. Bit positions are FROZEN (docs/SPEC.md §6.1) —
 * grain_mask values, cell keys, and parent lookups all depend on them.
 */
export const DIM_NAMES = [
  "platform",
  "ad_account",
  "campaign",
  "audience",
  "creative",
  "placement",
  "geo",
  "device",
  "offer",
  "cohort_week",
] as const;

export type DimName = (typeof DIM_NAMES)[number];
export type Dims = Partial<Record<DimName, string>>;

export const DIM_BIT: Record<DimName, number> = {
  platform: 0,
  ad_account: 1,
  campaign: 2,
  audience: 3,
  creative: 4,
  placement: 5,
  geo: 6,
  device: 7,
  offer: 8,
  cohort_week: 9,
};

/**
 * Delivery hierarchy H0–H4 (platform → account → campaign → audience →
 * creative). Empirical-Bayes parents are found by clearing the DEEPEST set
 * hierarchy bit; facet/time bits ride along unchanged.
 */
export const HIERARCHY_BITS = [0, 1, 2, 3, 4] as const;

export function grainMask(pinned: readonly DimName[]): number {
  let mask = 0;
  for (const d of pinned) mask |= 1 << DIM_BIT[d];
  return mask;
}

export function maskDims(mask: number): DimName[] {
  return DIM_NAMES.filter((d) => mask & (1 << DIM_BIT[d]));
}

/** Canonical string for hashing: bit-ordered `dim=value` pairs. */
function canonical(dims: Dims): string {
  return DIM_NAMES.filter((d) => dims[d] !== undefined)
    .map((d) => `${d}=${dims[d]}`)
    .join("|");
}

/**
 * Stable, URL-safe cell key. Content-addressed (mask + dim values), so keys
 * survive artifact regeneration as long as the cell itself exists.
 * Two 32-bit FNV passes (salted) → 13-ish chars of base36.
 */
export function cellKey(dims: Dims): string {
  const c = canonical(dims);
  const h1 = fnv1a32(c);
  const h2 = fnv1a32(`gt:${c}`);
  return `c${h1.toString(36)}${h2.toString(36)}`;
}

/** Pinned-dim subset of a subscriber/spend row for a given mask. */
export function projectDims(full: Record<DimName, string>, mask: number): Dims {
  const out: Dims = {};
  for (const d of DIM_NAMES) {
    if (mask & (1 << DIM_BIT[d])) out[d] = full[d];
  }
  return out;
}

/**
 * EB parent of a cell: clear the deepest set hierarchy bit. Returns null at
 * the global row (no hierarchy bits set → nothing to fall back to).
 */
export function parentOf(dims: Dims): { dims: Dims; mask: number } | null {
  const mask = grainMask(Object.keys(dims) as DimName[]);
  let deepest = -1;
  for (const bit of HIERARCHY_BITS) {
    if (mask & (1 << bit)) deepest = bit;
  }
  if (deepest < 0) {
    // facet/time-only cell: parent is the global row unless we ARE global
    if (mask === 0) return null;
    const gDims: Dims = {};
    return { dims: gDims, mask: 0 };
  }
  const parentMask = mask & ~(1 << deepest);
  const out: Dims = {};
  for (const d of DIM_NAMES) {
    if (parentMask & (1 << DIM_BIT[d])) out[d] = dims[d];
  }
  return { dims: out, mask: parentMask };
}
