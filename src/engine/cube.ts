import { COHORT_WEEKS, GRAINS, THRESHOLDS, confidenceOf, type GrainDef } from "./config";
import { cellKey, grainMask, projectDims, type Dims } from "./dims";
import { shrinkCell, varRawOf } from "./model/shrink";
import type { Subscriber, World } from "./dgp/world.types";
import { realizedAt } from "./dgp/world.types";
import type { CubeRow } from "./types";

/**
 * The cube: every curated grain, one pass (SPEC §7.4). Verdict fields are
 * initialized neutral here; verdicts.ts annotates them in place.
 */

export interface SubStats {
  realized_c: number;
  fe_c: number; // net revenue in days 0–7 (censored)
  pred_c: number;
  pred_var_c2: number;
  blended_c: number;
  maturity: number;
  buyer: boolean;
}

export function computeSubStats(
  sub: Subscriber,
  predict: (s: Subscriber) => { pred_c: number; var_c: number },
): SubStats {
  const horizon = Math.min(sub.age_days, 90);
  const realized_c = realizedAt(sub, sub.age_days);
  let fe_c = 0;
  let buyer = false;
  for (const e of sub.events) {
    if (e.day > horizon) continue;
    if (e.day <= 7) fe_c += e.amount_c;
    if (e.amount_c > 0) buyer = true;
  }
  const maturity = horizon / 90;
  const { pred_c, var_c } = predict(sub);
  const blended_c = realized_c + (1 - maturity) * Math.max(pred_c - realized_c, 0);
  return { realized_c, fe_c, pred_c, pred_var_c2: var_c, blended_c, maturity, buyer };
}

interface Acc {
  grain: GrainDef;
  dims: Dims;
  n_subs: number;
  spend_c: number;
  last_week_spend_c: number;
  plat_conv_c: number;
  optins: number;
  realized_c: number;
  fe_c: number;
  pred_c: number;
  pred_var_sum_c2: number;
  blended_sum_c: number;
  blended_sumsq_c2: number;
  maturity_sum: number;
  buyers: number;
  /** Censored revenue by day-since-acquisition — payback + series. */
  dayRev_c: Float64Array;
}

export interface CubeBuild {
  rows: CubeRow[];
  byKey: Map<string, CubeRow>;
  /** cell_key → cumulative realized revenue per subscriber by day (cents). */
  curves: Map<string, Float64Array>;
}

const LAST_WEEK = COHORT_WEEKS[COHORT_WEEKS.length - 1];

export function buildCube(
  world: World,
  predict: (s: Subscriber) => { pred_c: number; var_c: number },
): CubeBuild {
  // Grains ordered shallow → deep so parents are always built first.
  const ordered = [...GRAINS].sort((a, b) => a.dims.length - b.dims.length);

  const accs = new Map<string, Acc>();
  const accOf = (grain: GrainDef, dims: Dims): Acc => {
    const key = `${grain.name}:${cellKey(dims)}`;
    let a = accs.get(key);
    if (!a) {
      a = {
        grain,
        dims,
        n_subs: 0,
        spend_c: 0,
        last_week_spend_c: 0,
        plat_conv_c: 0,
        optins: 0,
        realized_c: 0,
        fe_c: 0,
        pred_c: 0,
        pred_var_sum_c2: 0,
        blended_sum_c: 0,
        blended_sumsq_c2: 0,
        maturity_sum: 0,
        buyers: 0,
        dayRev_c: new Float64Array(91),
      };
      accs.set(key, a);
    }
    return a;
  };

  // Spend pass.
  for (const row of world.spend) {
    for (const g of ordered) {
      const dims = projectDims(row.dims, grainMask(g.dims));
      const a = accOf(g, dims);
      a.spend_c += row.spend_c;
      a.plat_conv_c += row.plat_conv_value_c;
      a.optins += row.optins;
      if (row.week === LAST_WEEK) a.last_week_spend_c += row.spend_c;
    }
  }

  // Subscriber pass.
  for (const sub of world.subs) {
    const st = computeSubStats(sub, predict);
    const horizon = Math.min(sub.age_days, 90);
    for (const g of ordered) {
      const dims = projectDims(sub.dims, grainMask(g.dims));
      const a = accOf(g, dims);
      a.n_subs++;
      a.realized_c += st.realized_c;
      a.fe_c += st.fe_c;
      a.pred_c += st.pred_c;
      a.pred_var_sum_c2 += st.pred_var_c2;
      a.blended_sum_c += st.blended_c;
      a.blended_sumsq_c2 += st.blended_c * st.blended_c;
      a.maturity_sum += st.maturity;
      if (st.buyer) a.buyers++;
      for (const e of sub.events) {
        if (e.day <= horizon) a.dayRev_c[e.day] += e.amount_c;
      }
    }
  }

  // Row build + top-down shrinkage.
  const rows: CubeRow[] = [];
  const byKey = new Map<string, CubeRow>();
  const curves = new Map<string, Float64Array>();
  // var_post is needed by children during the pass but is not on CubeRow
  const varPost = new Map<string, number>();
  const grainByName = new Map(GRAINS.map((g) => [g.name, g]));

  for (const g of ordered) {
    for (const a of accs.values()) {
      if (a.grain !== g) continue;
      if (a.spend_c <= 0) continue; // cells exist only where money moved
      const key = cellKey(a.dims);
      const n = a.n_subs;
      const maturity_frac = n > 0 ? a.maturity_sum / n : 0;
      const mean_pred_var_c2 = n > 0 ? a.pred_var_sum_c2 / n : 0;
      const ltv_raw = a.blended_sum_c / a.spend_c;
      const var_raw = varRawOf({
        sum_c: a.blended_sum_c,
        sumsq_c2: a.blended_sumsq_c2,
        n,
        maturity_frac,
        mean_pred_var_c2,
        spend_c: a.spend_c,
      });

      let parentRow: CubeRow | null = null;
      if (g.parent) {
        const pDims: Dims = {};
        for (const d of grainByName.get(g.parent)!.dims) pDims[d] = a.dims[d];
        parentRow = byKey.get(cellKey(pDims)) ?? null;
      }
      const shrunk = shrinkCell({
        ltv_raw,
        n_subs: n,
        var_raw,
        parent: parentRow
          ? {
              ltv_shrunk: parentRow.ltv_shrunk,
              var_post: varPost.get(parentRow.cell_key) ?? THRESHOLDS.var_prior_floor,
            }
          : null,
      });

      // cumulative per-sub curve (kept for payback + series)
      const curve = new Float64Array(91);
      let cum = 0;
      for (let d = 0; d <= 90; d++) {
        cum += a.dayRev_c[d];
        curve[d] = n > 0 ? cum / n : 0;
      }
      curves.set(`${g.name}:${key}`, curve);

      const cpl_c = n > 0 ? a.spend_c / n : 0;
      // Payback = the day cumulative revenue crosses cost AND STAYS above it.
      // Impulse cells spike over the line on day 1 and get refunded back
      // under it — that is not payback, that is the flip.
      let payback_day: number | null = null;
      if (n > 0 && cpl_c > 0 && curve[90] >= cpl_c) {
        payback_day = 90;
        for (let d = 90; d >= 0 && curve[d] >= cpl_c; d--) payback_day = d;
      }

      const row: CubeRow = {
        cell_key: key,
        grain: g.name,
        grain_mask: grainMask(g.dims),
        dims: a.dims,
        parent_key: parentRow ? parentRow.cell_key : null,
        n_subs: n,
        spend_c: a.spend_c,
        last_week_spend_c: a.last_week_spend_c,
        realized_rev_c: Math.round(a.realized_c),
        fe_rev_c: Math.round(a.fe_c),
        be_rev_c: Math.round(a.realized_c - a.fe_c),
        pred_ltv_sum_c: Math.round(a.pred_c),
        blended_rev_c: Math.round(a.blended_sum_c),
        maturity_frac: round4(maturity_frac),
        cpl_c: Math.round(cpl_c),
        cac_c: a.buyers > 0 ? Math.round(a.spend_c / a.buyers) : 0,
        ltv_raw: round4(ltv_raw),
        ltv_shrunk: round4(shrunk.ltv_shrunk),
        shrink_weight: round4(shrunk.shrink_weight),
        ci_low: round4(shrunk.ci_low),
        ci_high: round4(shrunk.ci_high),
        platform_roas: round4(a.plat_conv_c / a.spend_c),
        confidence: round4(confidenceOf(n, maturity_frac, shrunk.shrink_weight)),
        payback_day,
        verdict: "WATCH",
        leaning: null,
        is_flip: false,
        dollar_impact_day_c: 0,
        reason: "",
      };
      varPost.set(key, shrunk.var_post);
      rows.push(row);
      byKey.set(key, row);
    }
  }

  return { rows, byKey, curves };
}

function round4(x: number): number {
  return Math.round(x * 10_000) / 10_000;
}
