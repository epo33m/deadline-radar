/**
 * Finding #8 tests for JWKS fetching hardening.
 * A local JWKS server (ES256 keys minted with jose) stands in for Supabase,
 * so refresh/cache/failure behavior is exercised for real:
 * - valid tokens verify (existing behavior preserved);
 * - a warm cache serves verification with zero new network calls;
 * - tampered/unknown-key tokens are rejected (fail closed);
 * - a cold cache against a dead endpoint rejects within the timeout;
 * - concurrent verifications share a single JWKS fetch (no thundering herd).
 */
process.env.NODE_ENV = "test";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { exportJWK, generateKeyPair, SignJWT } from "jose";

import {
  resetJwksCache,
  setVerifyAccessTokenClaimsOverride,
  setVerifyAccessTokenOverride,
  verifyAccessToken,
} from "./auth-tokens";

const savedSupabaseUrl = process.env.SUPABASE_URL;
const savedJwksTimeout = process.env.JWKS_TIMEOUT_MS;
const savedJwtSecret = process.env.SUPABASE_JWT_SECRET;

let server: ReturnType<typeof Bun.serve> | null = null;
let serverUp = true;
let jwksHits = 0;
let jwksBody: Record<string, unknown> = { keys: [] };

const KID = "test-key-1";
let privateKey: CryptoKey;

function baseUrl(): string {
  if (!server) throw new Error("server not started");
  return `http://127.0.0.1:${server.port}`;
}

function issuer(): string {
  return `${baseUrl()}/auth/v1`;
}

async function mintToken(
  claims: Record<string, unknown> = {},
  kid: string = KID,
  key: CryptoKey = privateKey,
): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  return new SignJWT({ sub: "user-1", email: "a@example.com", ...claims })
    .setProtectedHeader({ alg: "ES256", kid })
    .setIssuer(issuer())
    .setAudience("authenticated")
    .setIssuedAt(now)
    .setExpirationTime(now + 3600)
    .sign(key);
}

beforeEach(async () => {
  const { privateKey: priv, publicKey } = await generateKeyPair("ES256");
  privateKey = priv;
  const jwk = await exportJWK(publicKey);
  jwksBody = {
    keys: [{ ...jwk, kid: KID, alg: "ES256", use: "sig" }],
  };
  jwksHits = 0;
  serverUp = true;
  server = Bun.serve({
    port: 0,
    fetch: (request) => {
      const url = new URL(request.url);
      if (url.pathname === "/auth/v1/.well-known/jwks.json") {
        if (!serverUp) {
          return new Response("down", { status: 500 });
        }
        jwksHits += 1;
        return Response.json(jwksBody);
      }
      return new Response("not found", { status: 404 });
    },
  });
  process.env.SUPABASE_URL = baseUrl();
  process.env.JWKS_TIMEOUT_MS = "2000";
  // Hermetic against other test files sharing this process: drop injected
  // identity/claims overrides and the HS256 fallback secret.
  setVerifyAccessTokenOverride(null);
  setVerifyAccessTokenClaimsOverride(null);
  delete process.env.SUPABASE_JWT_SECRET;
  resetJwksCache();
});

afterEach(() => {
  server?.stop(true);
  server = null;
  resetJwksCache();
  if (savedSupabaseUrl === undefined) delete process.env.SUPABASE_URL;
  else process.env.SUPABASE_URL = savedSupabaseUrl;
  if (savedJwksTimeout === undefined) delete process.env.JWKS_TIMEOUT_MS;
  else process.env.JWKS_TIMEOUT_MS = savedJwksTimeout;
  if (savedJwtSecret === undefined) delete process.env.SUPABASE_JWT_SECRET;
  else process.env.SUPABASE_JWT_SECRET = savedJwtSecret;
});

describe("finding #8 — jwks fetching", () => {
  test("G. valid token verifies (existing behavior)", async () => {
    const token = await mintToken();
    const user = await verifyAccessToken(token);
    expect(user?.id).toBe("user-1");
    expect(jwksHits).toBe(1);
  });

  test("F. warm cache serves without network refresh", async () => {
    const token = await mintToken();
    expect((await verifyAccessToken(token))?.id).toBe("user-1");
    expect(jwksHits).toBe(1);
    serverUp = false;
    expect((await verifyAccessToken(token))?.id).toBe("user-1");
    expect(jwksHits).toBe(1);
  });

  test("F. tampered token is rejected (fail closed)", async () => {
    const token = await mintToken();
    const parts = token.split(".");
    const tampered = `${parts[0]}.${parts[1]}.AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA`;
    expect(await verifyAccessToken(tampered)).toBeNull();
  });

  test("F. unknown kid is rejected (fail closed)", async () => {
    const token = await mintToken({}, "unknown-kid");
    expect(await verifyAccessToken(token)).toBeNull();
  });

  test("F. cold cache against a dead endpoint rejects within the timeout", async () => {
    server?.stop(true);
    serverUp = false;
    // Point at a port nothing listens on so the failure is a fast refuse.
    process.env.SUPABASE_URL = "http://127.0.0.1:1";
    resetJwksCache();
    const started = Date.now();
    expect(await verifyAccessToken(await mintToken())).toBeNull();
    expect(Date.now() - started).toBeLessThan(10000);
  });

  test("F. concurrent verifications share a single JWKS fetch", async () => {
    const token = await mintToken();
    const results = await Promise.all(
      Array.from({ length: 8 }, () => verifyAccessToken(token)),
    );
    expect(results.every((user) => user?.id === "user-1")).toBe(true);
    expect(jwksHits).toBe(1);
  });

  describe("M6-L-1 — JWT audience verification", () => {
    test("rejects token with missing or unauthenticated audience", async () => {
      const now = Math.floor(Date.now() / 1000);
      // Token without audience
      const tokenNoAud = await new SignJWT({ sub: "user-1", email: "a@example.com" })
        .setProtectedHeader({ alg: "ES256", kid: KID })
        .setIssuer(issuer())
        .setIssuedAt(now)
        .setExpirationTime(now + 3600)
        .sign(privateKey);
      expect(await verifyAccessToken(tokenNoAud)).toBeNull();

      // Token with anon audience
      const tokenAnonAud = await new SignJWT({ sub: "user-1", email: "a@example.com" })
        .setProtectedHeader({ alg: "ES256", kid: KID })
        .setIssuer(issuer())
        .setAudience("anon")
        .setIssuedAt(now)
        .setExpirationTime(now + 3600)
        .sign(privateKey);
      expect(await verifyAccessToken(tokenAnonAud)).toBeNull();
    });

    test("accepts token with authenticated audience", async () => {
      const validToken = await mintToken();
      const user = await verifyAccessToken(validToken);
      expect(user?.id).toBe("user-1");
    });
  });
});
