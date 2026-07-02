/** Money and metric formatting — integer cents in, human strings out. */

export function usd(cents: number, opts: { compact?: boolean } = {}): string {
  const sign = cents < 0 ? "−" : "";
  const dollars = Math.abs(cents) / 100;
  if (opts.compact && dollars >= 1_000_000) {
    return `${sign}$${(dollars / 1_000_000).toLocaleString("en-US", { maximumFractionDigits: 2 })}M`;
  }
  if (opts.compact && dollars >= 10_000) {
    return `${sign}$${(dollars / 1000).toLocaleString("en-US", { maximumFractionDigits: 1 })}k`;
  }
  return `${sign}$${Math.round(dollars).toLocaleString("en-US")}`;
}

export function usdExact(cents: number): string {
  return `$${(cents / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export function mult(x: number, digits = 2): string {
  return `${x.toFixed(digits)}×`;
}

export function pct(frac: number): string {
  return `${Math.round(frac * 100)}%`;
}

/** "meta · crypto-curious · hype-10x · reels · mobile" */
export function cellPath(dims: Record<string, string | undefined>): string {
  return (
    Object.values(dims)
      .filter(Boolean)
      .join(" · ") || "portfolio"
  );
}
