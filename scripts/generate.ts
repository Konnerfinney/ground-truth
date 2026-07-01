import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import {
  COHORT_WEEKS,
  FLIP_CELL,
  FLIP_CELL_KEY,
  GRAINS,
  SEED,
  SNAPSHOT_AT,
  THRESHOLDS,
  UNTAPPED_CELL,
  UNTAPPED_CELL_KEY,
  VALIDATE,
} from "../src/engine/config";
import { grainMask } from "../src/engine/dims";
import { buildCube } from "../src/engine/cube";
import { generateWorld } from "../src/engine/dgp/world";
import { calibrationReport, predictLtv, trainLtvModel } from "../src/engine/model/ltv";
import { decompose, decomposeBaseline, recoveryReport } from "../src/engine/model/decompose";
import { Rng } from "../src/engine/rand";
import { annotateVerdicts, assembleBrief } from "../src/engine/verdicts";
import { validate } from "../src/engine/validate";
import type { ArtifactEnvelope, SeriesEntry } from "../src/engine/types";

/**
 * The "nightly snapshot" job, demo edition: world → model → cube → verdicts →
 * brief → artifacts. Deterministic from (config, SEED) — byte-identical on
 * every run; `snapshot_at` is the DGP's own clock, never wall time.
 */

const OUT = path.join(process.cwd(), "data", "artifacts");
const envelope: ArtifactEnvelope = { schema_version: 1, seed: SEED, snapshot_at: SNAPSHOT_AT, source: "synthetic" };

function write(name: string, data: unknown): number {
  const json = JSON.stringify(data);
  writeFileSync(path.join(OUT, name), json);
  return json.length;
}

const t0 = performance.now();
console.log("· generating world…");
const world = generateWorld(SEED);

console.log("· training LTV model…");
const model = trainLtvModel(world.subs, new Rng(SEED).split("model"));
const calibration = calibrationReport(model, model.holdout);

console.log("· decomposing…");
const effects = decompose(world.subs);
const baseline = decomposeBaseline(world.subs);
const recovery = recoveryReport(effects, world.truth, new Rng(SEED).split("recovery"));

console.log("· building cube…");
const cube = buildCube(world, (s) => predictLtv(s, model));

console.log("· verdicts + brief…");
const imputed = annotateVerdicts(cube.rows, { effects, baseline });
const brief = assembleBrief(cube.rows, world);

console.log("· series…");
const SERIES_DAYS = Array.from({ length: 14 }, (_, i) => Math.min(90, i * 7));
const seriesFor = new Set<string>();
for (const c of brief.cards) seriesFor.add(c.cell_key);
seriesFor.add(FLIP_CELL_KEY);
seriesFor.add(UNTAPPED_CELL_KEY);
for (const r of cube.rows) {
  if (Object.keys(r.dims).length <= 3) seriesFor.add(r.cell_key);
}
const series: SeriesEntry[] = [];
for (const r of cube.rows) {
  if (!seriesFor.has(r.cell_key)) continue;
  const curve = cube.curves.get(`${r.grain}:${r.cell_key}`);
  if (!curve) continue;
  series.push({
    cell_key: r.cell_key,
    week: SERIES_DAYS.map((d) => `d${d}`),
    cum_rev_per_sub_c: SERIES_DAYS.map((d) => Math.round(curve[d])),
    cac_c: r.cpl_c, // the payback line: spend per acquired subscriber
    n: r.n_subs,
  });
}
const seriesKeys = new Set(series.map((s) => s.cell_key));

console.log("· validate…");
const report = validate({
  world,
  rows: cube.rows,
  byKey: cube.byKey,
  brief,
  imputed,
  seriesKeys,
  recovery,
  calibration,
});

console.log("· writing artifacts…");
mkdirSync(OUT, { recursive: true });
const sizes: Record<string, number> = {};
sizes["cube.json"] = write("cube.json", { ...envelope, rows: cube.rows });
sizes["decisions.json"] = write("decisions.json", { ...envelope, ...brief });
sizes["series.json"] = write("series.json", { ...envelope, entries: series });
sizes["dim_effects.json"] = write("dim_effects.json", { ...envelope, effects });
sizes["recovery.json"] = write("recovery.json", {
  ...envelope,
  ...recovery,
  calibration,
  shrinkage_note: "see meta.json validate report",
});
sizes["truth_effects.json"] = write("truth_effects.json", {
  ...envelope,
  note: "THE PLANTED ANSWER KEY — published for transparency; never read by model/cube/query code (import-graph-tested).",
  ...world.truth,
});
sizes["meta.json"] = write("meta.json", {
  ...envelope,
  thresholds: THRESHOLDS,
  validate_bands: VALIDATE,
  cohort_weeks: COHORT_WEEKS,
  grains: GRAINS.map((g) => ({ name: g.name, dims: g.dims, grain_mask: grainMask(g.dims), parent: g.parent })),
  flip_cell: FLIP_CELL,
  flip_cell_key: FLIP_CELL_KEY,
  untapped_cell: UNTAPPED_CELL,
  untapped_cell_key: UNTAPPED_CELL_KEY,
  counts: { subscribers: world.subs.length, spend_rows: world.spend.length, cube_rows: cube.rows.length, brief_cards: brief.cards.length, series_entries: series.length },
  model: { n_train: model.n_train, n_train_buyers: model.n_train_buyers, holdout: model.holdout.length },
  validate: report,
});

const secs = ((performance.now() - t0) / 1000).toFixed(1);
console.log(`\nartifact sizes: ${Object.entries(sizes).map(([k, v]) => `${k} ${(v / 1e6).toFixed(1)}MB`).join(" · ")}`);
console.log(`cube rows: ${cube.rows.length} · brief: $${Math.round(brief.headline_bleed_c / 100)}/day bleed + $${Math.round(brief.headline_upside_c / 100)}/day upside across ${brief.cards.length} cards`);
console.log(`\nvalidate:core ${report.core_pass ? "PASS" : "FAIL"}`);
for (const c of report.core) console.log(`  ${c.pass ? "✓" : "✗"} ${c.name} — ${c.detail}`);
console.log(`validate:stats ${report.stats_pass ? "PASS" : "WARN"}`);
for (const c of report.stats) console.log(`  ${c.pass ? "✓" : "⚠"} ${c.name} — ${c.detail}`);
console.log(`\ndone in ${secs}s`);

if (!report.core_pass) {
  console.error("\nvalidate:core FAILED — artifacts written for inspection but MUST NOT ship.");
  process.exit(1);
}
