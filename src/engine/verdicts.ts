import { THRESHOLDS } from "./config";
import type { Dims } from "./dims";
import type { DecomposeBaseline } from "./model/decompose";
import { imputeLtvPerDollar } from "./model/decompose";
import type { World } from "./dgp/world.types";
import type { BriefCard, CubeRow, DimEffect, Verdict } from "./types";

/**
 * The decision engine (SPEC §7.5). Verdicts are FINAL here — the UI and the
 * MCP read the same annotated rows, so they can never tell different stories.
 */

const fmtUsd = (c: number) => `$${Math.round(Math.abs(c) / 100).toLocaleString("en-US")}`;
const fmtX = (x: number) => `${x.toFixed(2)}×`;

interface GrainFloors {
  material_c: number; // p50 of nonzero spend_day within grain
  high_c: number; // p75
  starved_c: number; // starved_frac × median spend_day of funded rows (n ≥ n_floor)
  median_sibling_spend_day_c: number;
}

function quantile(sorted: number[], q: number): number {
  if (sorted.length === 0) return 0;
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * q))];
}

function grainFloors(rows: CubeRow[]): Map<string, GrainFloors> {
  const byGrain = new Map<string, CubeRow[]>();
  for (const r of rows) {
    let g = byGrain.get(r.grain);
    if (!g) byGrain.set(r.grain, (g = []));
    g.push(r);
  }
  const floors = new Map<string, GrainFloors>();
  for (const [grain, rs] of byGrain) {
    const spendDays = rs
      .map((r) => r.last_week_spend_c / 7)
      .filter((x) => x > 0)
      .sort((a, b) => a - b);
    const fundedSpendDays = rs
      .filter((r) => r.n_subs >= THRESHOLDS.n_floor)
      .map((r) => r.spend_c / 7 / 18) // whole-window daily average for stability
      .sort((a, b) => a - b);
    floors.set(grain, {
      material_c: quantile(spendDays, THRESHOLDS.spend_material_q),
      high_c: quantile(spendDays, THRESHOLDS.spend_high_q),
      starved_c: THRESHOLDS.starved_frac * quantile(fundedSpendDays, 0.5),
      median_sibling_spend_day_c: quantile(fundedSpendDays, 0.5),
    });
  }
  return floors;
}

/** Siblings share the row's grain and all dims except exactly one. */
function siblingCpls(row: CubeRow, rowsInGrain: CubeRow[]): number[] {
  const dims = Object.entries(row.dims);
  const out: number[] = [];
  for (const other of rowsInGrain) {
    if (other.cell_key === row.cell_key || other.n_subs < THRESHOLDS.n_floor) continue;
    let diff = 0;
    for (const [d, v] of dims) {
      if ((other.dims as Record<string, string>)[d] !== v) diff++;
      if (diff > 1) break;
    }
    if (diff === 1 && other.cpl_c > 0) out.push(other.cpl_c);
  }
  return out;
}

export interface VerdictContext {
  effects: DimEffect[];
  baseline: DecomposeBaseline;
}

/**
 * Annotate every cube row in place with its final verdict + impact + reason.
 * Returns the imputed LTV-per-dollar for rows where imputation ran (validate
 * asserts the planted UNTAPPED cell's value against its band).
 */
export function annotateVerdicts(rows: CubeRow[], ctx: VerdictContext): Map<string, number> {
  const imputedByKey = new Map<string, number>();
  const floors = grainFloors(rows);
  const byGrain = new Map<string, CubeRow[]>();
  for (const r of rows) {
    let g = byGrain.get(r.grain);
    if (!g) byGrain.set(r.grain, (g = []));
    g.push(r);
  }
  const H = THRESHOLDS.hurdle;

  for (const r of rows) {
    const f = floors.get(r.grain)!;
    const spendDay = r.last_week_spend_c / 7;
    const avgSpendDay = r.spend_c / (7 * 18);
    const effectiveSpendDay = spendDay > 0 ? spendDay : avgSpendDay;

    // Raw verdict — precedence: KILL → TRIM → SCALE → UNTAPPED → WATCH.
    let raw: Verdict = "WATCH";
    let imputed: number | null = null;
    if (r.ci_high < H && r.n_subs >= THRESHOLDS.n_floor && effectiveSpendDay >= f.material_c) {
      raw = "KILL";
    } else if (
      r.ltv_shrunk < H &&
      H <= r.ci_high &&
      r.n_subs >= THRESHOLDS.n_floor &&
      effectiveSpendDay >= f.high_c
    ) {
      raw = "TRIM";
    } else if (r.ci_low > H + THRESHOLDS.scale_margin && r.n_subs >= THRESHOLDS.n_floor) {
      raw = "SCALE";
    } else if (avgSpendDay < f.starved_c && Object.keys(r.dims).length >= 3) {
      imputed = imputeLtvPerDollar(
        r.dims as Dims,
        ctx.effects,
        siblingCpls(r, byGrain.get(r.grain)!),
        ctx.baseline,
      );
      if (imputed !== null) {
        imputedByKey.set(r.cell_key, imputed);
        if (imputed >= H * THRESHOLDS.untapped_mult) raw = "UNTAPPED";
      }
    }

    // Engine-level forcing: not enough evidence ⇒ WATCH, keep the leaning.
    // UNTAPPED is exempt — it is BY DESIGN a low-evidence, clearly-speculative call.
    let verdict = raw;
    let leaning: Verdict | null = null;
    if (
      raw !== "WATCH" &&
      raw !== "UNTAPPED" &&
      (r.confidence < THRESHOLDS.conf_floor || r.maturity_frac < THRESHOLDS.maturity_floor)
    ) {
      verdict = "WATCH";
      leaning = raw;
    }

    const is_flip = r.platform_roas >= 1 && r.ci_high < H && (verdict === "KILL" || verdict === "TRIM");

    // $ impact / day.
    let impact = 0;
    if (verdict === "KILL" || verdict === "TRIM") {
      impact = Math.max(0, effectiveSpendDay * (1 - r.ltv_shrunk));
    } else if (verdict === "SCALE") {
      impact = Math.min(effectiveSpendDay, effectiveSpendDay * (r.ltv_shrunk - H));
    } else if (verdict === "UNTAPPED" && imputed !== null) {
      impact = f.median_sibling_spend_day_c * (imputed - H);
    }

    r.verdict = verdict;
    r.leaning = leaning;
    r.is_flip = is_flip;
    r.dollar_impact_day_c = Math.round(impact);
    r.reason = reasonFor(r, imputed, effectiveSpendDay);
  }
  return imputedByKey;
}

function reasonFor(r: CubeRow, imputed: number | null, spendDay: number): string {
  const range = `${fmtX(r.ci_low)}–${fmtX(r.ci_high)}`;
  const borrowed = r.shrink_weight > 0.01 ? `, ${Math.round(r.shrink_weight * 100)}% borrowed from parent` : "";
  const basis = `n=${r.n_subs}, ${Math.round(r.maturity_frac * 90)}d observed${borrowed}`;
  switch (r.verdict) {
    case "KILL":
      return `${r.is_flip ? `Platform reports ${fmtX(r.platform_roas)} ROAS, but true` : "True"} 90-day LTV:CAC is ${fmtX(r.ltv_shrunk)} (range ${range}) — even the best case loses money. Bleeding ~${fmtUsd(r.dollar_impact_day_c)}/day (${basis}).`;
    case "TRIM":
      return `${r.is_flip ? `Platform reports ${fmtX(r.platform_roas)} ROAS, but true` : "True"} LTV:CAC is ${fmtX(r.ltv_shrunk)} — below break-even, though the range ${range} still straddles it. High spend makes this the first place to pull back (${basis}).`;
    case "SCALE":
      return `True LTV:CAC is ${fmtX(r.ltv_shrunk)} and even the LOW end of the range (${range}) clears break-even with margin. Platform credits only ${fmtX(r.platform_roas)} — under-scaled. Headroom ~${fmtUsd(r.dollar_impact_day_c)}/day, assuming flat marginal CAC (${basis}).`;
    case "UNTAPPED":
      return `Barely funded, but composing its traits predicts ~${fmtX(imputed ?? 0)} LTV per dollar — a speculative estimate from similar cells, not observed performance. Worth a test budget (spend ~${fmtUsd(spendDay)}/day today; ${basis}).`;
    default:
      return r.leaning
        ? `Leaning ${r.leaning}, but not enough evidence yet to act (${basis}). Needs more subscribers or cohort age before this verdict fires.`
        : `No clear signal either way yet (${basis}).`;
  }
}

// ---------------------------------------------------------------------------
// Brief assembly — greedy, leaf-disjoint (SPEC §7.5; kills the double-count).
// ---------------------------------------------------------------------------

export interface Brief {
  headline_bleed_c: number;
  headline_upside_c: number;
  cards: BriefCard[];
}

export function assembleBrief(rows: CubeRow[], world: World): Brief {
  // Leaf atoms = full-dim spend rows; a card covers the atoms matching its dims.
  const atomDims = world.spend.map((r) => r.dims as Record<string, string>);
  const atomsOf = (dims: Dims): Set<number> => {
    const entries = Object.entries(dims) as [string, string][];
    const out = new Set<number>();
    for (let i = 0; i < atomDims.length; i++) {
      let ok = true;
      for (const [d, v] of entries) {
        if (atomDims[i][d] !== v) {
          ok = false;
          break;
        }
      }
      if (ok) out.add(i);
    }
    return out;
  };

  // A "move" targets something a buyer can actually touch — never the whole
  // portfolio or a whole platform (those would swallow every leaf atom and
  // reduce the brief to one card).
  const candidates = rows
    .filter((r) => r.verdict !== "WATCH" && r.dollar_impact_day_c > 0 && Object.keys(r.dims).length >= 2)
    .sort(
      (a, b) =>
        b.dollar_impact_day_c * b.confidence - a.dollar_impact_day_c * a.confidence ||
        a.cell_key.localeCompare(b.cell_key),
    );

  const covered = new Set<number>();
  const cards: BriefCard[] = [];
  const cardAtoms = new Map<string, Set<number>>(); // accepted key → its atom set

  for (const cand of candidates) {
    if (cards.length >= 24) break;
    const atoms = atomsOf(cand.dims as Dims);
    if (atoms.size === 0) continue;

    let overlaps = false;
    for (const a of atoms) {
      if (covered.has(a)) {
        overlaps = true;
        break;
      }
    }
    if (overlaps) {
      // Fold into the first accepted card sharing coverage — same dollars,
      // seen from another grain: corroboration, not a second count.
      const host = cards.find((c) => {
        const ha = cardAtoms.get(c.cell_key)!;
        for (const a of atoms) if (ha.has(a)) return true;
        return false;
      });
      if (host && host.also_visible_at.length < 6) host.also_visible_at.push(cand.cell_key);
      continue;
    }

    for (const a of atoms) covered.add(a);
    const kind: BriefCard["kind"] = cand.verdict === "KILL" || cand.verdict === "TRIM" ? "bleed" : "upside";
    cards.push({
      cell_key: cand.cell_key,
      verdict: cand.verdict,
      is_flip: cand.is_flip,
      dollar_impact_day_c: cand.dollar_impact_day_c,
      kind,
      estimate_basis: kind === "bleed" ? "measured" : "marginal_cac_naive",
      covered_leaves: atoms.size,
      also_visible_at: [],
      reason: cand.reason,
    });
    cardAtoms.set(cand.cell_key, atoms);
  }

  return {
    headline_bleed_c: cards.filter((c) => c.kind === "bleed").reduce((a, c) => a + c.dollar_impact_day_c, 0),
    headline_upside_c: cards.filter((c) => c.kind === "upside").reduce((a, c) => a + c.dollar_impact_day_c, 0),
    cards,
  };
}
