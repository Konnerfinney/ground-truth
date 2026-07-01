import { describe, expect, it } from "vitest";
import { Rng } from "@/engine/rand";
import {
  accumulateNormalEquations,
  choleskySolve,
  sparseDot,
  type SparseRow,
} from "@/engine/model/linalg";
import { fitLogistic, fitRidge, predictLogistic } from "@/engine/model/fit";

function denseRow(vals: number[]): SparseRow {
  return { idx: vals.map((_, i) => i), val: vals };
}

describe("choleskySolve", () => {
  it("solves a known SPD system", () => {
    // A = [[4,2],[2,3]], b = [10, 8] → x = [1.75, 1.5]
    const a = new Float64Array([4, 2, 2, 3]);
    const b = new Float64Array([10, 8]);
    const x = choleskySolve(a, b, 2);
    expect(x[0]).toBeCloseTo(1.75, 10);
    expect(x[1]).toBeCloseTo(1.5, 10);
  });

  it("throws on a non-PD matrix", () => {
    const a = new Float64Array([1, 2, 2, 1]); // eigenvalues 3, -1
    expect(() => choleskySolve(a, new Float64Array([1, 1]), 2)).toThrow(/positive-definite/);
  });
});

describe("accumulateNormalEquations", () => {
  it("matches the dense computation on a small case", () => {
    const rows = [denseRow([1, 2]), denseRow([3, 4]), denseRow([5, 6])];
    const y = [1, 2, 3];
    const { xtx, xty } = accumulateNormalEquations(rows, y, 2);
    // XtX = [[35,44],[44,56]], Xty = [22, 28]
    expect([...xtx]).toEqual([35, 44, 44, 56]);
    expect([...xty]).toEqual([22, 28]);
  });
});

describe("fitRidge", () => {
  it("recovers known coefficients from noisy sparse one-hot data", () => {
    const rng = new Rng(101);
    const trueW = [2.0, -1.0, 0.5, 3.0, 0.0]; // col 0 = intercept
    const rows: SparseRow[] = [];
    const y: number[] = [];
    for (let i = 0; i < 5000; i++) {
      const group = rng.int(1, 4); // one active one-hot col among 1..4
      const row: SparseRow = { idx: [0, group], val: [1, 1] };
      rows.push(row);
      y.push(sparseDot(row, trueW as unknown as number[]) + rng.normal(0, 0.3));
    }
    const w = fitRidge(rows, y, 5, 1.0, 0);
    // Intercept + exhaustive one-hots are collinear, so raw coefficients are
    // not identified — only within-dimension CONTRASTS are. This is exactly
    // why the decomposition centers effects within each dimension (SPEC §7.3).
    expect(w[1] - w[4]).toBeCloseTo(-1.0, 1);
    expect(w[2] - w[4]).toBeCloseTo(0.5, 1);
    expect(w[3] - w[4]).toBeCloseTo(3.0, 1);
    // predictions ARE identified
    const pred = sparseDot({ idx: [0, 3], val: [1, 1] }, w as unknown as number[]);
    expect(pred).toBeCloseTo(5.0, 1);
  });
});

describe("fitLogistic", () => {
  it("recovers a known decision boundary", () => {
    const rng = new Rng(202);
    const trueW = [-1.0, 2.5]; // intercept, slope on x
    const rows: SparseRow[] = [];
    const y: number[] = [];
    for (let i = 0; i < 8000; i++) {
      const x = rng.normal(0, 1);
      const p = 1 / (1 + Math.exp(-(trueW[0] + trueW[1] * x)));
      rows.push({ idx: [0, 1], val: [1, x] });
      y.push(rng.bernoulli(p) ? 1 : 0);
    }
    const w = fitLogistic(rows, y, 2, 0.1);
    expect(w[0]).toBeCloseTo(-1.0, 0);
    expect(w[1]).toBeCloseTo(2.5, 0);
    // calibration: mean predicted ≈ base rate
    const meanP = rows.reduce((s, r) => s + predictLogistic(r, w), 0) / rows.length;
    const baseRate = y.reduce((a, b) => a + b, 0) / y.length;
    expect(meanP).toBeCloseTo(baseRate, 2);
  });

  it("stays finite under complete separation (L2 keeps Hessian PD)", () => {
    // x<0 → always 0, x>0 → always 1: unregularized MLE diverges
    const rows: SparseRow[] = [];
    const y: number[] = [];
    for (let i = 0; i < 200; i++) {
      const x = i < 100 ? -1 - i / 100 : 1 + (i - 100) / 100;
      rows.push({ idx: [0, 1], val: [1, x] });
      y.push(x > 0 ? 1 : 0);
    }
    const w = fitLogistic(rows, y, 2, 1.0);
    expect(Number.isFinite(w[0])).toBe(true);
    expect(Number.isFinite(w[1])).toBe(true);
    expect(Math.abs(w[1])).toBeLessThan(50);
    expect(w[1]).toBeGreaterThan(0);
  });
});
