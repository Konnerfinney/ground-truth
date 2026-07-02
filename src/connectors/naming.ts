/**
 * The naming-convention parser — the connector nobody sells you.
 *
 * Platform APIs report DELIVERED dimensions (placement, device, geo) but not
 * SEMANTIC ones (audience theme, creative angle, offer). Those live in how
 * the team names campaigns/adsets/ads. Convention (order-free, case-free):
 *
 *   "Q3 Inflation | aud:retirement | ang:education | off:core-99"
 *   "aud=crypto-curious ang=hype-10x off=tw7"
 *
 * Tokens: aud/audience, ang/angle/creative, off/offer — separated by
 * `:` or `=`, delimited by `|`, `_`, `,` or whitespace. Adset names override
 * campaign names; ad names override both (most specific wins).
 */

export interface ParsedNames {
  audience: string | null;
  creative: string | null;
  offer: string | null;
}

const KEYS: Record<string, keyof ParsedNames> = {
  aud: "audience",
  audience: "audience",
  ang: "creative",
  angle: "creative",
  creative: "creative",
  cre: "creative",
  off: "offer",
  offer: "offer",
};

const TOKEN = /\b(aud|audience|ang|angle|creative|cre|off|offer)\s*[:=]\s*([a-z0-9][a-z0-9-]*)/gi;

export function parseName(name: string): ParsedNames {
  const out: ParsedNames = { audience: null, creative: null, offer: null };
  for (const m of name.matchAll(TOKEN)) {
    const key = KEYS[m[1].toLowerCase()];
    if (key && out[key] === null) out[key] = m[2].toLowerCase();
  }
  return out;
}

/** Most specific name wins: ad > adset > campaign. */
export function parseNameHierarchy(campaign: string, adset: string, ad: string): ParsedNames {
  const c = parseName(campaign);
  const s = parseName(adset);
  const a = parseName(ad);
  return {
    audience: a.audience ?? s.audience ?? c.audience,
    creative: a.creative ?? s.creative ?? c.creative,
    offer: a.offer ?? s.offer ?? c.offer,
  };
}
