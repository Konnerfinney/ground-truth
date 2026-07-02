import { NextRequest, NextResponse } from "next/server";
import { exchangeCode, verifyIdToken } from "@/lib/auth/oidc";
import { SESSION_COOKIE, authConfigured, sessionCookieOptions, signSession } from "@/lib/auth/session";

/**
 * Complete the OIDC dance: state must match (CSRF), the code is exchanged
 * with the PKCE verifier, the ID token is verified against Google's JWKS
 * including OUR nonce — then and only then a session is minted. Failures
 * land on /settings with a generic error param; details are never echoed.
 */
export async function GET(req: NextRequest) {
  if (!authConfigured()) {
    return NextResponse.json({ error: "auth_not_configured" }, { status: 404 });
  }
  const fail = (reason: string) => {
    const res = NextResponse.redirect(`${req.nextUrl.origin}/settings?auth_error=${reason}`);
    for (const c of ["gt_oauth_state", "gt_oauth_nonce", "gt_oauth_verifier"]) {
      res.cookies.set(c, "", { path: "/api/auth", maxAge: 0 });
    }
    return res;
  };

  const code = req.nextUrl.searchParams.get("code");
  const state = req.nextUrl.searchParams.get("state");
  const cookieState = req.cookies.get("gt_oauth_state")?.value;
  const nonce = req.cookies.get("gt_oauth_nonce")?.value;
  const verifier = req.cookies.get("gt_oauth_verifier")?.value;

  if (!code || !state || !cookieState || !nonce || !verifier) return fail("missing_params");
  if (state !== cookieState) return fail("state_mismatch");

  try {
    const { id_token } = await exchangeCode({
      code,
      verifier,
      clientId: process.env.GOOGLE_OAUTH_CLIENT_ID!,
      clientSecret: process.env.GOOGLE_OAUTH_CLIENT_SECRET!,
      redirectUri: `${req.nextUrl.origin}/api/auth/callback`,
    });
    const identity = await verifyIdToken(id_token, process.env.GOOGLE_OAUTH_CLIENT_ID!, nonce);
    const session = await signSession(identity);

    const res = NextResponse.redirect(`${req.nextUrl.origin}/settings`);
    res.cookies.set(SESSION_COOKIE, session, sessionCookieOptions());
    for (const c of ["gt_oauth_state", "gt_oauth_nonce", "gt_oauth_verifier"]) {
      res.cookies.set(c, "", { path: "/api/auth", maxAge: 0 });
    }
    return res;
  } catch {
    return fail("verification_failed");
  }
}
