import { NextResponse } from "next/server";
import { authConfigured, getSession } from "@/lib/auth/session";

/** Session probe for the header chip — keeps static pages static. */
export async function GET() {
  if (!authConfigured()) return NextResponse.json({ configured: false, user: null });
  const user = await getSession();
  return NextResponse.json({
    configured: true,
    user: user ? { email: user.email, name: user.name, picture: user.picture } : null,
  });
}
