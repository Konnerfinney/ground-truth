import { SignJWT, jwtVerify } from "jose";
import { cookies } from "next/headers";

/**
 * Stateless sessions: our own HS256 JWT in an httpOnly cookie. No database —
 * workspace rows will key off `sub` (the stable Google account id) when the
 * credential vault lands. Auth is OPTIONAL by construction: with no
 * AUTH_SECRET / Google client configured, nothing auth-related renders and
 * the app behaves exactly as before.
 */

export const SESSION_COOKIE = "gt_session";
export const SESSION_MAX_AGE_S = 7 * 24 * 3600;

export interface SessionUser {
  sub: string; // Google account id — the future workspace key
  email: string;
  name: string;
  picture: string | null;
}

export function authConfigured(): boolean {
  return Boolean(
    process.env.AUTH_SECRET && process.env.GOOGLE_OAUTH_CLIENT_ID && process.env.GOOGLE_OAUTH_CLIENT_SECRET,
  );
}

function secretKey(secret = process.env.AUTH_SECRET): Uint8Array {
  if (!secret || secret.length < 32) {
    throw new Error("AUTH_SECRET must be set (>=32 chars); generate with: openssl rand -base64 32");
  }
  return new TextEncoder().encode(secret);
}

/** Pure + testable: user → signed compact JWT. */
export async function signSession(user: SessionUser, secret?: string): Promise<string> {
  return new SignJWT({ email: user.email, name: user.name, picture: user.picture })
    .setSubject(user.sub)
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setIssuer("ground-truth")
    .setAudience("ground-truth")
    .setExpirationTime(`${SESSION_MAX_AGE_S}s`)
    .sign(secretKey(secret));
}

/** Pure + testable: token → user, or null for anything invalid/expired. */
export async function verifySession(token: string, secret?: string): Promise<SessionUser | null> {
  try {
    const { payload } = await jwtVerify(token, secretKey(secret), {
      issuer: "ground-truth",
      audience: "ground-truth",
    });
    if (!payload.sub || typeof payload.email !== "string") return null;
    return {
      sub: payload.sub,
      email: payload.email,
      name: typeof payload.name === "string" ? payload.name : payload.email,
      picture: typeof payload.picture === "string" ? payload.picture : null,
    };
  } catch {
    return null;
  }
}

/** Server-side session read for RSC pages and route handlers. */
export async function getSession(): Promise<SessionUser | null> {
  if (!authConfigured()) return null;
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (!token) return null;
  return verifySession(token);
}

export function sessionCookieOptions() {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax" as const,
    path: "/",
    maxAge: SESSION_MAX_AGE_S,
  };
}
