import { xoroshiro128plus } from "pure-rand/generator/xoroshiro128plus";
import { uniformInt } from "pure-rand/distribution/uniformInt";
import type { RandomGenerator } from "pure-rand/types/RandomGenerator";

/**
 * Deterministic random streams for the synthetic DGP.
 *
 * Every stage of generation gets its own child stream (`rng.split(label)`) so
 * adding draws to one stage never perturbs another — the artifact diff stays
 * local to the thing you changed.
 */

const FNV_OFFSET = 0xcbf29ce4;
const FNV_PRIME = 0x01000193;

/** 32-bit FNV-1a — used to derive child-stream seeds and cell keys. */
export function fnv1a32(input: string): number {
  let h = FNV_OFFSET;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, FNV_PRIME);
  }
  return h >>> 0;
}

export class Rng {
  private readonly gen: RandomGenerator;
  private readonly seed: number;

  constructor(seed: number) {
    this.seed = seed >>> 0;
    this.gen = xoroshiro128plus(this.seed);
  }

  /** Uniform float in [0, 1). */
  next(): number {
    return uniformInt(this.gen, 0, 0xffffffff) / 0x100000000;
  }

  /** Uniform integer in [min, max] inclusive. */
  int(min: number, max: number): number {
    return uniformInt(this.gen, min, max);
  }

  /** Independent child stream keyed by label — order-insensitive derivation. */
  split(label: string): Rng {
    return new Rng((this.seed ^ fnv1a32(label)) >>> 0);
  }

  bernoulli(p: number): boolean {
    return this.next() < p;
  }

  /** Standard normal via Box-Muller. */
  normal(mu = 0, sigma = 1): number {
    let u1 = this.next();
    if (u1 === 0) u1 = Number.MIN_VALUE;
    const u2 = this.next();
    const z = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
    return mu + sigma * z;
  }

  lognormal(mu: number, sigma: number): number {
    return Math.exp(this.normal(mu, sigma));
  }

  /** Poisson: Knuth for small λ, normal approximation above. */
  poisson(lambda: number): number {
    if (lambda <= 0) return 0;
    if (lambda < 30) {
      const limit = Math.exp(-lambda);
      let k = 0;
      let p = 1;
      do {
        k++;
        p *= this.next();
      } while (p > limit);
      return k - 1;
    }
    return Math.max(0, Math.round(this.normal(lambda, Math.sqrt(lambda))));
  }

  /** Binomial: exact draw-by-draw for small n, normal approximation above. */
  binomial(n: number, p: number): number {
    if (n <= 0 || p <= 0) return 0;
    if (p >= 1) return n;
    if (n < 100) {
      let s = 0;
      for (let i = 0; i < n; i++) if (this.next() < p) s++;
      return s;
    }
    const mean = n * p;
    const sd = Math.sqrt(n * p * (1 - p));
    return Math.min(n, Math.max(0, Math.round(this.normal(mean, sd))));
  }

  /** Pareto Type I: support [xm, ∞), tail index alpha. */
  pareto(xm: number, alpha: number): number {
    let u = this.next();
    if (u === 0) u = Number.MIN_VALUE;
    return xm / Math.pow(u, 1 / alpha);
  }

  /** Sample an index from unnormalized weights. */
  categorical(weights: readonly number[]): number {
    let total = 0;
    for (const w of weights) total += w;
    let r = this.next() * total;
    for (let i = 0; i < weights.length; i++) {
      r -= weights[i];
      if (r < 0) return i;
    }
    return weights.length - 1;
  }

  /** Fisher-Yates shuffle (returns a new array). */
  shuffle<T>(items: readonly T[]): T[] {
    const out = items.slice();
    for (let i = out.length - 1; i > 0; i--) {
      const j = this.int(0, i);
      [out[i], out[j]] = [out[j], out[i]];
    }
    return out;
  }
}

/** Zipf weights for ranks 1..n (deterministic; sample with rng.categorical). */
export function zipfWeights(n: number, alpha: number): number[] {
  const w = new Array<number>(n);
  for (let i = 0; i < n; i++) w[i] = 1 / Math.pow(i + 1, alpha);
  return w;
}

/** Logistic sigmoid. */
export function sigmoid(x: number): number {
  return 1 / (1 + Math.exp(-x));
}
