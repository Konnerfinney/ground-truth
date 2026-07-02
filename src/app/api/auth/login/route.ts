import { NextRequest, NextResponse } from "next/server";
import { buildAuthRequest } from "@/lib/auth/oidc";
import { authConfigured } from "@/lib/auth/session";

/** Start the Google OIDC dance: park state/nonce/verifier in short-lived
 * httpOnly cookies, redirect to Google. */
export async function GET(req: NextRequest) {
  if (!authConfigured()) {
    return NextResponse.json({ error: "auth_not_configured" }, { status: 404 });
  }
  const redirectUri = `${req.nextUrl.origin}/api/auth/callback`;
  const auth = await buildAuthRequest(process.env.GOOGLE_OAUTH_CLIENT_ID!, redirectUri);

  const res = NextResponse.redirect(auth.url);
  const flow = {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax" as const,
    path: "/api/auth",
    maxAge: 600, // the dance should take seconds, not minutes
  };
  res.cookies.set("gt_oauth_state", auth.state, flow);
  res.cookies.set("gt_oauth_nonce", auth.nonce, flow);
  res.cookies.set("gt_oauth_verifier", auth.verifier, flow);
  return res;
}
