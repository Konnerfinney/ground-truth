import {
  accumulateNormalEquations,
  choleskySolve,
  sparseDot,
  type SparseRow,
} from "./linalg";
import { sigmoid } from "../rand";

/**
 * Ridge regression: minimize ‖Xw − y‖² + λ‖w‖² (intercept unpenalized when
 * `interceptIdx` is given a tiny λ floor instead — keeps the system PD).
 */
export function fitRidge(
  rows: readonly SparseRow[],
  y: readonly number[],
  d: number,
  lambda: number,
  interceptIdx?: number,
): Float64Array {
  const { xtx, xty } = accumulateNormalEquations(rows, y, d);
  for (let i = 0; i < d; i++) {
    const pen = i === interceptIdx ? Math.min(lambda, 1e-6) : lambda;
    xtx[i * d + i] += pen;
  }
  return choleskySolve(xtx, xty, d);
}

/**
 * L2-regularized logistic regression via IRLS (Newton with a working
 * response). The ridge term keeps the Hessian positive-definite even under
 * complete separation, so this cannot diverge to ±∞.
 */
export function fitLogistic(
  rows: readonly SparseRow[],
  y: readonly number[], // 0/1 labels
  d: number,
  lambda: number,
  maxIter = 25,
  tol = 1e-6,
): Float64Array {
  let w: Float64Array = new Float64Array(d);
  for (let iter = 0; iter < maxIter; iter++) {
    // working weights and response for the weighted least-squares step
    const irlsW = new Array<number>(rows.length);
    const z = new Array<number>(rows.length);
    for (let r = 0; r < rows.length; r++) {
      const eta = sparseDot(rows[r], w);
      const mu = sigmoid(eta);
      const s = Math.max(mu * (1 - mu), 1e-6);
      irlsW[r] = s;
      z[r] = eta + (y[r] - mu) / s;
    }
    const { xtx, xty } = accumulateNormalEquations(rows, z, d, irlsW);
    for (let i = 0; i < d; i++) xtx[i * d + i] += lambda;
    const next = choleskySolve(xtx, xty, d);
    let delta = 0;
    for (let i = 0; i < d; i++) delta = Math.max(delta, Math.abs(next[i] - w[i]));
    w = next;
    if (delta < tol) break;
  }
  return w;
}

/** Predicted probability for one row under a logistic fit. */
export function predictLogistic(row: SparseRow, w: Float64Array): number {
  return sigmoid(sparseDot(row, w));
}

/** Predicted value for one row under a linear fit. */
export function predictLinear(row: SparseRow, w: Float64Array): number {
  return sparseDot(row, w);
}
