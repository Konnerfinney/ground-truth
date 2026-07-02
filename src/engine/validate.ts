import { FLIP_CELL_KEY, GRAINS, SEED, UNTAPPED_CELL_KEY, VALIDATE } from "./config";
import { cellKey, grainMask, projectDims } from "./dims";
import { generateWorld } from "./dgp/world";
import { trueLtv90, type World } from "./dgp/world.types";
import type { RecoveryReport } from "./model/decompose";
import type { Brief } from "./verdicts";
import type { CubeRow, ValidateReport } from "./types";

/**
 * The demo-guarantee gate (SPEC §7.6). validate:core failing = the build must
 * not ship. validate:stats is warn-only until the Jul 3 hard gate — its
 * report ships in meta.json either way (transparency is the product).
 */

export interface ValidateInputs {
  world: World;
  rows: CubeRow[];
  byKey: Map<string, CubeRow>;
  brief: Brief;
  imputed: Map<string, number>;
  seriesKeys: Set<string>;
  recovery: RecoveryReport;
  calibration: { overall: number; by_stratum: Record<string, number> };
}

type Check = { name: string; pass: boolean; detail: string };

const NUMERIC_FIELDS: (keyof CubeRow)[] = [
  "n_subs", "spend_c", "last_week_spend_c", "realized_rev_c", "fe_rev_c", "be_rev_c",
  "pred_ltv_sum_c", "blended_rev_c", "maturity_frac", "cpl_c", "cac_c", "ltv_raw",
  "ltv_shrunk", "shrink_weight", "ci_low", "ci_high", "platform_roas", "confidence",
  "dollar_impact_day_c",
];

export function validate(inp: ValidateInputs): ValidateReport {
  const core: Check[] = [];
  const stats: Check[] = [];
  const { world, rows, byKey, brief, imputed } = inp;

  // One pass: sidecar true-LTV sum per cell_key across every curated grain.
  const truthLtvByKey = new Map<string, number>();
  for (const s of world.subs) {
    const t = trueLtv90(s);
    for (const g of GRAINS) {
      const k = cellKey(projectDims(s.dims, grainMask(g.dims)));
      truthLtvByKey.set(k, (truthLtvByKey.get(k) ?? 0) + t);
    }
  }
  const sidecarLtvCac = (row: CubeRow): number =>
    (truthLtvByKey.get(row.cell_key) ?? 0) / row.spend_c;

  // 1 — THE FLIP row.
  const flip = byKey.get(FLIP_CELL_KEY);
  {
    const [lo, hi] = VALIDATE.flip_platform_roas;
    const trueLtvCac = flip ? sidecarLtvCac(flip) : NaN;
    core.push({
      name: "flip.exists+bands",
      pass:
        !!flip &&
        flip.platform_roas >= lo &&
        flip.platform_roas <= hi &&
        trueLtvCac < 1.0 &&
        (flip.verdict === "KILL" || flip.verdict === "TRIM") &&
        flip.is_flip,
      detail: flip
        ? `plat_roas=${flip.platform_roas} (band ${lo}-${hi}), sidecar true ltv:cac=${trueLtvCac.toFixed(2)} (<1), verdict=${flip.verdict}, is_flip=${flip.is_flip}, n=${flip.n_subs}`
        : "flip cell row missing from cube",
    });
  }

  // 2 — THE UNTAPPED row.
  const unt = byKey.get(UNTAPPED_CELL_KEY);
  {
    const [lo, hi] = VALIDATE.untapped_imputed_ltv_cac;
    const imp = unt ? imputed.get(unt.cell_key) : undefined;
    core.push({
      name: "untapped.exists+bands",
      pass: !!unt && unt.verdict === "UNTAPPED" && imp !== undefined && imp >= lo && imp <= hi,
      detail: unt
        ? `verdict=${unt.verdict}, imputed=${imp?.toFixed(2) ?? "none"} (band ${lo}-${hi}), spend=$${Math.round(unt.spend_c / 100)}, n=${unt.n_subs}`
        : "untapped cell row missing from cube",
    });
  }

  // 3 — sparsity emerged.
  {
    const counts = new Map<string, number>();
    for (const s of world.subs) {
      const k = Object.values(s.dims).join("|");
      counts.set(k, (counts.get(k) ?? 0) + 1);
    }
    const cells = new Set(world.spend.map((r) => Object.values(r.dims).join("|")));
    let thin = 0;
    for (const c of cells) if ((counts.get(c) ?? 0) <= 5) thin++;
    const frac = thin / cells.size;
    core.push({
      name: "sparsity",
      pass: frac >= VALIDATE.min_leaf_sparsity,
      detail: `${(frac * 100).toFixed(1)}% of ${cells.size} leaf cells have ≤5 subs (need ≥${VALIDATE.min_leaf_sparsity * 100}%)`,
    });
  }

  // 4 — referential integrity.
  {
    const badParents = rows.filter((r) => r.parent_key !== null && !byKey.has(r.parent_key)).length;
    const orphanGlobals = rows.filter((r) => r.parent_key === null && r.grain !== "global").length;
    const briefMissing = brief.cards.filter(
      (c) => !byKey.has(c.cell_key) || !inp.seriesKeys.has(c.cell_key),
    ).length;
    core.push({
      name: "referential-integrity",
      pass: badParents === 0 && orphanGlobals === 0 && briefMissing === 0,
      detail: `dangling parents=${badParents}, non-global orphans=${orphanGlobals}, brief cells missing cube/series=${briefMissing}`,
    });
  }

  // 5 — brief non-degenerate.
  {
    const verdicts = new Set(brief.cards.map((c) => c.verdict));
    const hasFlipCard = brief.cards.some((c) => c.is_flip);
    core.push({
      name: "brief.non-degenerate",
      pass:
        verdicts.size >= 3 &&
        hasFlipCard &&
        brief.headline_bleed_c >= VALIDATE.min_headline_bleed_c &&
        brief.headline_upside_c > 0,
      detail: `verdict groups=${[...verdicts].join(",")}, flip card=${hasFlipCard}, bleed=$${Math.round(brief.headline_bleed_c / 100)}/day (need ≥$${VALIDATE.min_headline_bleed_c / 100}), upside=$${Math.round(brief.headline_upside_c / 100)}/day`,
    });
  }

  // 6 — every number finite.
  {
    let bad = 0;
    let example = "";
    for (const r of rows) {
      for (const f of NUMERIC_FIELDS) {
        const v = r[f] as number;
        if (!Number.isFinite(v)) {
          bad++;
          if (!example) example = `${r.cell_key}.${String(f)}=${v}`;
        }
      }
      if (r.payback_day !== null && !Number.isFinite(r.payback_day)) bad++;
    }
    core.push({ name: "all-finite", pass: bad === 0, detail: bad ? `${bad} non-finite values (${example})` : `all ${rows.length} rows finite` });
  }

  // --- stats gates ---------------------------------------------------------

  // 7 — recovery.
  stats.push({
    name: "recovery.correlations",
    pass:
      inp.recovery.value_corr >= VALIDATE.min_recovery_corr &&
      inp.recovery.conv_corr >= VALIDATE.min_recovery_corr &&
      Math.abs(inp.recovery.negative_control_corr) <= VALIDATE.max_negative_control_corr,
    detail: `value=${inp.recovery.value_corr.toFixed(3)}, conv=${inp.recovery.conv_corr.toFixed(3)} (need ≥${VALIDATE.min_recovery_corr}), negative control=${inp.recovery.negative_control_corr.toFixed(3)} (|·|≤${VALIDATE.max_negative_control_corr})`,
  });

  // 8 — the shipped estimate beats the naive own-data average on thin cells.
  // Ground truth = the cell's LONG-RUN expected per-subscriber value, pooled
  // from REGENERATED worlds (fresh seeds). A mature cell's own realized value
  // IS its sidecar draw, so scoring against the sidecar is degenerate — the
  // honest target is the expectation. Story-grain cells are campaign-free,
  // so the same cell exists across seeds and its expectation is well-defined.
  {
    const story5 = GRAINS.find((g) => g.name === "story-5")!;
    const story5Mask = grainMask(story5.dims);
    const thin = rows.filter(
      (r) =>
        r.grain === "story-5" &&
        r.n_subs >= 1 &&
        r.n_subs <= 10 &&
        r.spend_c > 0 &&
        r.maturity_frac >= 0.85 &&
        r.parent_key !== null,
    );
    const thinKeys = new Set(thin.map((r) => r.cell_key));
    const expectation = new Map<string, { ltv: number; n: number }>();
    const N_REPLICATES = 14;
    for (let rep = 1; rep <= N_REPLICATES; rep++) {
      const replicate = generateWorld(SEED * 31 + rep);
      for (const s of replicate.subs) {
        const k2 = cellKey(projectDims(s.dims, story5Mask));
        if (!thinKeys.has(k2)) continue;
        const e = expectation.get(k2) ?? { ltv: 0, n: 0 };
        e.ltv += trueLtv90(s);
        e.n++;
        expectation.set(k2, e);
      }
    }
    let maeShipped = 0;
    let maeNaive = 0;
    let n = 0;
    for (const r of thin) {
      const e = expectation.get(r.cell_key);
      if (!e || e.n < 30) continue; // need a stable expectation to score against
      const truthPerSub = e.ltv / e.n;
      const naivePerSub = r.realized_rev_c / r.n_subs; // the average a buyer would compute
      const shippedPerSub = r.ltv_shrunk * r.cpl_c; // shipped LTV-per-dollar × spend-per-sub
      maeShipped += Math.abs(shippedPerSub - truthPerSub);
      maeNaive += Math.abs(naivePerSub - truthPerSub);
      n++;
    }
    stats.push({
      name: "shrinkage-beats-raw",
      pass: n >= 30 && maeShipped < maeNaive,
      detail: `shipped estimate vs naive own-data average on ${n} thin mature story cells (n≤10), scored against each cell's long-run expected value pooled from ${N_REPLICATES} regenerated worlds: MAE shipped=$${(maeShipped / Math.max(1, n) / 100).toFixed(2)} vs naive=$${(maeNaive / Math.max(1, n) / 100).toFixed(2)} per subscriber.`,
    });
  }

  // 9 — calibration (out-of-sample).
  {
    const [lo, hi] = VALIDATE.calibration_band;
    const strata = Object.entries(inp.calibration.by_stratum);
    const allIn =
      inp.calibration.overall >= lo &&
      inp.calibration.overall <= hi &&
      strata.every(([, v]) => v >= lo && v <= hi);
    stats.push({
      name: "calibration",
      pass: allIn,
      detail: `overall=${inp.calibration.overall.toFixed(3)}, ${strata.map(([k, v]) => `${k}=${v.toFixed(3)}`).join(", ")} (band ${lo}-${hi})`,
    });
  }

  return {
    core,
    stats,
    core_pass: core.every((c) => c.pass),
    stats_pass: stats.every((c) => c.pass),
  };
}
