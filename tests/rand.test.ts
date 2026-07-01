import { describe, expect, it } from "vitest";
import { Rng, fnv1a32, sigmoid, zipfWeights } from "@/engine/rand";

const N = 20_000;

function mean(xs: number[]): number {
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}

function variance(xs: number[]): number {
  const m = mean(xs);
  return xs.reduce((a, b) => a + (b - m) ** 2, 0) / xs.length;
}

describe("determinism", () => {
  it("same seed produces identical sequences", () => {
    const a = new Rng(42);
    const b = new Rng(42);
    for (let i = 0; i < 100; i++) expect(a.next()).toBe(b.next());
  });

  it("different seeds diverge", () => {
    const a = new Rng(1);
    const b = new Rng(2);
    const draws = Array.from({ length: 20 }, () => a.next() === b.next());
    expect(draws.some((eq) => !eq)).toBe(true);
  });

  it("split streams are label-keyed and independent of draw order", () => {
    const root1 = new Rng(7);
    root1.next(); // consuming the parent must not affect children
    const child1 = root1.split("spend");
    const child2 = new Rng(7).split("spend");
    for (let i = 0; i < 20; i++) expect(child1.next()).toBe(child2.next());
    const other = new Rng(7).split("revenue");
    expect(other.next()).not.toBe(new Rng(7).split("spend").next());
  });
});

describe("distribution moments (seeded, tolerances loose but diagnostic)", () => {
  it("uniform next() in [0,1) with mean ~0.5", () => {
    const rng = new Rng(11);
    const xs = Array.from({ length: N }, () => rng.next());
    expect(Math.min(...xs)).toBeGreaterThanOrEqual(0);
    expect(Math.max(...xs)).toBeLessThan(1);
    expect(mean(xs)).toBeCloseTo(0.5, 1);
  });

  it("normal(3, 2) has mean ~3, sd ~2", () => {
    const rng = new Rng(12);
    const xs = Array.from({ length: N }, () => rng.normal(3, 2));
    expect(mean(xs)).toBeCloseTo(3, 1);
    expect(Math.sqrt(variance(xs))).toBeCloseTo(2, 1);
  });

  it("poisson mean matches lambda in both regimes", () => {
    const rng = new Rng(13);
    const small = Array.from({ length: N }, () => rng.poisson(4));
    const large = Array.from({ length: N }, () => rng.poisson(80));
    expect(mean(small)).toBeGreaterThan(3.8);
    expect(mean(small)).toBeLessThan(4.2);
    expect(mean(large)).toBeGreaterThan(78);
    expect(mean(large)).toBeLessThan(82);
    expect(small.every((k) => Number.isInteger(k) && k >= 0)).toBe(true);
  });

  it("binomial(20, 0.3) has mean ~6 and support [0,20]", () => {
    const rng = new Rng(14);
    const xs = Array.from({ length: N }, () => rng.binomial(20, 0.3));
    expect(mean(xs)).toBeGreaterThan(5.8);
    expect(mean(xs)).toBeLessThan(6.2);
    expect(Math.min(...xs)).toBeGreaterThanOrEqual(0);
    expect(Math.max(...xs)).toBeLessThanOrEqual(20);
  });

  it("pareto(1000, 1.6) respects the floor and is heavy-tailed", () => {
    const rng = new Rng(15);
    const xs = Array.from({ length: N }, () => rng.pareto(1000, 1.6));
    expect(Math.min(...xs)).toBeGreaterThanOrEqual(1000);
    // alpha=1.6 → E[X] = alpha*xm/(alpha-1) ≈ 2667; sample mean is noisy but should exceed 2x floor
    expect(mean(xs)).toBeGreaterThan(2000);
  });

  it("bernoulli(0.25) fires ~25%", () => {
    const rng = new Rng(16);
    const hits = Array.from({ length: N }, () => (rng.bernoulli(0.25) ? 1 : 0));
    expect(mean(hits as number[])).toBeCloseTo(0.25, 1);
  });

  it("categorical follows the weights", () => {
    const rng = new Rng(17);
    const counts = [0, 0, 0];
    for (let i = 0; i < N; i++) counts[rng.categorical([1, 2, 7])]++;
    expect(counts[2] / N).toBeCloseTo(0.7, 1);
    expect(counts[0] / N).toBeCloseTo(0.1, 1);
  });
});

describe("helpers", () => {
  it("zipfWeights is monotone decreasing with the right head/tail ratio", () => {
    const w = zipfWeights(100, 1.0);
    expect(w[0]).toBe(1);
    expect(w[9]).toBeCloseTo(0.1, 5);
    for (let i = 1; i < w.length; i++) expect(w[i]).toBeLessThan(w[i - 1]);
  });

  it("sigmoid is centered and bounded", () => {
    expect(sigmoid(0)).toBe(0.5);
    expect(sigmoid(10)).toBeGreaterThan(0.999);
    expect(sigmoid(-10)).toBeLessThan(0.001);
  });

  it("fnv1a32 is stable and collision-free on dimension-ish strings", () => {
    expect(fnv1a32("meta")).toBe(fnv1a32("meta"));
    const keys = ["meta", "google", "taboola", "tiktok", "retirement", "hype-10x"];
    const hashes = new Set(keys.map(fnv1a32));
    expect(hashes.size).toBe(keys.length);
  });

  it("shuffle is a permutation and seed-stable", () => {
    const rng = new Rng(18);
    const shuffled = rng.shuffle([1, 2, 3, 4, 5]);
    expect([...shuffled].sort()).toEqual([1, 2, 3, 4, 5]);
    expect(new Rng(18).shuffle([1, 2, 3, 4, 5])).toEqual(shuffled);
  });
});
