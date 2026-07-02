import { SignJWT, exportJWK, generateKeyPair, type JWTVerifyGetKey, createLocalJWKSet } from "jose";
import { afterEach, describe, expect, it } from "vitest";
import { buildAuthRequest, exchangeCode, pkceChallenge, randomUrlSafe, verifyIdToken } from "@/lib/auth/oidc";
import { signSession, verifySession } from "@/lib/auth/session";

const SECRET = "test-secret-test-secret-test-secret!!";

describe("session JWT", () => {
  const user = { sub: "g-123", email: "k@example.com", name: "Konner", picture: null };

  it("round-trips a valid session", async () => {
    const token = await signSession(user, SECRET);
    expect(await verifySession(token, SECRET)).toEqual(user);
  });

  it("rejects tampering, wrong secret, and garbage", async () => {
    const token = await signSession(user, SECRET);
    expect(await verifySession(token + "x", SECRET)).toBeNull();
    expect(await verifySession(token, "another-secret-another-secret-32ch")).toBeNull();
    expect(await verifySession("not-a-jwt", SECRET)).toBeNull();
  });

  it("refuses weak secrets outright", async () => {
    await expect(signSession(user, "short")).rejects.toThrow(/AUTH_SECRET/);
  });
});

describe("OIDC building blocks", () => {
  it("PKCE challenge matches RFC 7636 S256 test vector", async () => {
    // Appendix B of RFC 7636
    expect(await pkceChallenge("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk")).toBe(
      "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM",
    );
  });

  it("auth request carries state, nonce, S256 challenge and the right params", async () => {
    const req = await buildAuthRequest("client-1", "https://app.example/api/auth/callback");
    const url = new URL(req.url);
    expect(url.origin + url.pathname).toBe("https://accounts.google.com/o/oauth2/v2/auth");
    expect(url.searchParams.get("client_id")).toBe("client-1");
    expect(url.searchParams.get("state")).toBe(req.state);
    expect(url.searchParams.get("nonce")).toBe(req.nonce);
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
    expect(url.searchParams.get("code_challenge")).toBe(await pkceChallenge(req.verifier));
    expect(url.searchParams.get("scope")).toBe("openid email profile");
    // high-entropy, distinct values
    expect(new Set([req.state, req.nonce, req.verifier]).size).toBe(3);
    expect(randomUrlSafe()).not.toBe(randomUrlSafe());
  });
});

describe("ID token verification (local JWKS — same code path as Google's)", () => {
  async function makeToken(overrides: Record<string, unknown> = {}, aud = "client-1", nonce = "n-1") {
    const { privateKey, publicKey } = await generateKeyPair("RS256");
    const jwk = { ...(await exportJWK(publicKey)), alg: "RS256", kid: "k1" };
    const getKey: JWTVerifyGetKey = createLocalJWKSet({ keys: [jwk] });
    const token = await new SignJWT({
      email: "k@example.com",
      name: "Konner",
      picture: "https://p.example/x.png",
      nonce,
      ...overrides,
    })
      .setProtectedHeader({ alg: "RS256", kid: "k1" })
      .setSubject("g-123")
      .setIssuer("https://accounts.google.com")
      .setAudience(aud)
      .setIssuedAt()
      .setExpirationTime("5m")
      .sign(privateKey);
    return { token, getKey };
  }

  it("accepts a valid token and extracts the identity", async () => {
    const { token, getKey } = await makeToken();
    const id = await verifyIdToken(token, "client-1", "n-1", getKey);
    expect(id).toEqual({
      sub: "g-123",
      email: "k@example.com",
      name: "Konner",
      picture: "https://p.example/x.png",
    });
  });

  it("rejects nonce mismatch (replay), wrong audience, wrong issuer", async () => {
    const good = await makeToken();
    await expect(verifyIdToken(good.token, "client-1", "OTHER", good.getKey)).rejects.toThrow(/nonce/);

    const wrongAud = await makeToken({}, "someone-else");
    await expect(verifyIdToken(wrongAud.token, "client-1", "n-1", wrongAud.getKey)).rejects.toThrow();

    const { privateKey, publicKey } = await generateKeyPair("RS256");
    const jwk = { ...(await exportJWK(publicKey)), alg: "RS256", kid: "k1" };
    const getKey = createLocalJWKSet({ keys: [jwk] });
    const badIss = await new SignJWT({ email: "k@example.com", nonce: "n-1" })
      .setProtectedHeader({ alg: "RS256", kid: "k1" })
      .setSubject("g-123")
      .setIssuer("https://evil.example")
      .setAudience("client-1")
      .setIssuedAt()
      .setExpirationTime("5m")
      .sign(privateKey);
    await expect(verifyIdToken(badIss, "client-1", "n-1", getKey)).rejects.toThrow();
  });

  it("rejects a token signed by a DIFFERENT key (signature check is real)", async () => {
    const a = await makeToken();
    const b = await makeToken();
    await expect(verifyIdToken(a.token, "client-1", "n-1", b.getKey)).rejects.toThrow();
  });
});

describe("token exchange", () => {
  afterEach(() => undefined);

  it("posts the code + PKCE verifier and returns the id_token", async () => {
    let seenBody = "";
    const fetchImpl = (async (_url: string, init?: RequestInit) => {
      seenBody = String(init?.body);
      return new Response(JSON.stringify({ id_token: "idt" }), { status: 200 });
    }) as unknown as typeof fetch;
    const out = await exchangeCode({
      code: "c0de",
      verifier: "v3rifier",
      clientId: "id",
      clientSecret: "sec",
      redirectUri: "https://app.example/api/auth/callback",
      fetchImpl,
    });
    expect(out.id_token).toBe("idt");
    const params = new URLSearchParams(seenBody);
    expect(params.get("grant_type")).toBe("authorization_code");
    expect(params.get("code_verifier")).toBe("v3rifier");
  });

  it("fails closed without echoing response bodies", async () => {
    const fetchImpl = (async () =>
      new Response('{"error":"invalid_grant","secret_detail":"XYZ"}', { status: 400 })) as unknown as typeof fetch;
    const err = await exchangeCode({
      code: "c",
      verifier: "v",
      clientId: "i",
      clientSecret: "s",
      redirectUri: "r",
      fetchImpl,
    }).catch((e: Error) => e.message);
    expect(err).toContain("token exchange failed (400)");
    expect(err).not.toContain("XYZ");
  });
});
