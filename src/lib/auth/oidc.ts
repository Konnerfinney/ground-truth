import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from "jose";

/**
 * Google OIDC, authorization-code flow with PKCE — implemented directly so
 * every step is auditable: state (CSRF), nonce (token replay), S256 code
 * challenge (code interception), and full ID-token verification against
 * Google's JWKS (signature, issuer, audience, expiry, nonce).
 */

export const GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
export const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
export const GOOGLE_JWKS_URL = "https://www.googleapis.com/oauth2/v3/certs";
export const GOOGLE_ISSUERS = ["https://accounts.google.com", "accounts.google.com"];

export function randomUrlSafe(bytes = 32): string {
  const buf = new Uint8Array(bytes);
  crypto.getRandomValues(buf);
  return b64url(buf);
}

function b64url(buf: Uint8Array): string {
  let s = "";
  for (const b of buf) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** PKCE: challenge = BASE64URL(SHA-256(verifier)). Pure + testable. */
export async function pkceChallenge(verifier: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
  return b64url(new Uint8Array(digest));
}

export interface AuthRequest {
  url: string;
  state: string;
  nonce: string;
  verifier: string;
}

export async function buildAuthRequest(clientId: string, redirectUri: string): Promise<AuthRequest> {
  const state = randomUrlSafe();
  const nonce = randomUrlSafe();
  const verifier = randomUrlSafe(48);
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: "openid email profile",
    state,
    nonce,
    code_challenge: await pkceChallenge(verifier),
    code_challenge_method: "S256",
    prompt: "select_account",
  });
  return { url: `${GOOGLE_AUTH_URL}?${params}`, state, nonce, verifier };
}

export interface GoogleIdentity {
  sub: string;
  email: string;
  name: string;
  picture: string | null;
}

let jwks: JWTVerifyGetKey | null = null;
function googleJwks(): JWTVerifyGetKey {
  jwks ??= createRemoteJWKSet(new URL(GOOGLE_JWKS_URL));
  return jwks;
}

/**
 * Verify a Google ID token: signature via JWKS, issuer, audience, expiry
 * (jose enforces exp/iat), and OUR nonce. `getKey` is injectable so tests
 * verify the validation logic against a local key instead of Google.
 */
export async function verifyIdToken(
  idToken: string,
  clientId: string,
  expectedNonce: string,
  getKey: JWTVerifyGetKey = googleJwks(),
): Promise<GoogleIdentity> {
  const { payload } = await jwtVerify(idToken, getKey, {
    issuer: GOOGLE_ISSUERS,
    audience: clientId,
  });
  if (payload.nonce !== expectedNonce) throw new Error("oidc: nonce mismatch");
  if (!payload.sub || typeof payload.email !== "string") throw new Error("oidc: token missing sub/email");
  return {
    sub: payload.sub,
    email: payload.email,
    name: typeof payload.name === "string" ? payload.name : payload.email,
    picture: typeof payload.picture === "string" ? payload.picture : null,
  };
}

/** Exchange the authorization code (confidential client + PKCE verifier). */
export async function exchangeCode(opts: {
  code: string;
  verifier: string;
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  fetchImpl?: typeof fetch;
}): Promise<{ id_token: string }> {
  const res = await (opts.fetchImpl ?? fetch)(GOOGLE_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code: opts.code,
      code_verifier: opts.verifier,
      client_id: opts.clientId,
      client_secret: opts.clientSecret,
      redirect_uri: opts.redirectUri,
    }),
  });
  if (!res.ok) {
    throw new Error(`oidc: token exchange failed (${res.status})`); // never echo the body: it can carry sensitive detail
  }
  const json = (await res.json()) as { id_token?: string };
  if (!json.id_token) throw new Error("oidc: no id_token in token response");
  return { id_token: json.id_token };
}
