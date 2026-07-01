/**
 * Minimal dense linear algebra for the model layer.
 *
 * Design rows are sparse (each subscriber activates ~10 of ~260 one-hot
 * columns plus a few dense behavior columns), so we accumulate XᵀX with
 * sparse outer products and solve the small dense system with Cholesky.
 */

/** One observation: parallel arrays of active column indices and values. */
export interface SparseRow {
  idx: number[];
  val: number[];
}

/** Symmetric XᵀX (dense, row-major d×d) and Xᵀy accumulated from sparse rows. */
export function accumulateNormalEquations(
  rows: readonly SparseRow[],
  y: readonly number[],
  d: number,
  sampleWeights?: readonly number[],
): { xtx: Float64Array; xty: Float64Array } {
  const xtx = new Float64Array(d * d);
  const xty = new Float64Array(d);
  for (let r = 0; r < rows.length; r++) {
    const { idx, val } = rows[r];
    const w = sampleWeights ? sampleWeights[r] : 1;
    const wy = w * y[r];
    for (let a = 0; a < idx.length; a++) {
      const ia = idx[a];
      const va = val[a] * w;
      xty[ia] += val[a] * wy;
      for (let b = a; b < idx.length; b++) {
        const ib = idx[b];
        const prod = va * val[b];
        if (ia <= ib) xtx[ia * d + ib] += prod;
        else xtx[ib * d + ia] += prod;
      }
    }
  }
  // mirror the upper triangle
  for (let i = 0; i < d; i++) {
    for (let j = i + 1; j < d; j++) {
      xtx[j * d + i] = xtx[i * d + j];
    }
  }
  return { xtx, xty };
}

/**
 * Solve A x = b for symmetric positive-definite A via Cholesky (A = L Lᵀ).
 * Mutates neither input. Throws if A is not positive-definite — callers add
 * a ridge term to guarantee PD.
 */
export function choleskySolve(a: Float64Array, b: Float64Array, d: number): Float64Array {
  const l = new Float64Array(a); // will hold L in the lower triangle
  for (let j = 0; j < d; j++) {
    let diag = l[j * d + j];
    for (let k = 0; k < j; k++) diag -= l[j * d + k] ** 2;
    if (diag <= 0) throw new Error(`choleskySolve: matrix not positive-definite at pivot ${j}`);
    const lj = Math.sqrt(diag);
    l[j * d + j] = lj;
    for (let i = j + 1; i < d; i++) {
      let s = l[i * d + j];
      for (let k = 0; k < j; k++) s -= l[i * d + k] * l[j * d + k];
      l[i * d + j] = s / lj;
    }
  }
  // forward solve L z = b
  const z = new Float64Array(d);
  for (let i = 0; i < d; i++) {
    let s = b[i];
    for (let k = 0; k < i; k++) s -= l[i * d + k] * z[k];
    z[i] = s / l[i * d + i];
  }
  // back solve Lᵀ x = z
  const x = new Float64Array(d);
  for (let i = d - 1; i >= 0; i--) {
    let s = z[i];
    for (let k = i + 1; k < d; k++) s -= l[k * d + i] * x[k];
    x[i] = s / l[i * d + i];
  }
  return x;
}

/** Dot product of a sparse row with a dense weight vector. */
export function sparseDot(row: SparseRow, w: Float64Array | number[]): number {
  let s = 0;
  for (let a = 0; a < row.idx.length; a++) s += row.val[a] * (w as number[])[row.idx[a]];
  return s;
}
