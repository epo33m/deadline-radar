import { createRemoteJWKSet, jwtVerify } from "jose";

import { resolveSupabaseUrl } from "../env";

export const ACCESS_COOKIE = "dr_access_token";
export const REFRESH_COOKIE = "dr_refresh_token";

export type AuthUser = {
  id: string;
  email: string | undefined;
};

let jwks: ReturnType<typeof createRemoteJWKSet> | null = null;

function getJwks() {
  if (!jwks) {
    const base = resolveSupabaseUrl().replace(/\/$/, "");
    jwks = createRemoteJWKSet(
      new URL(`${base}/auth/v1/.well-known/jwks.json`),
    );
  }
  return jwks;
}

function issuer(): string {
  return `${resolveSupabaseUrl().replace(/\/$/, "")}/auth/v1`;
}

/**
 * Verify Supabase access tokens.
 * New projects use asymmetric ES256 via JWKS; legacy HS256 JWT secret is a fallback.
 */
export async function verifyAccessToken(
  token: string,
): Promise<AuthUser | null> {
  try {
    const { payload } = await jwtVerify(token, getJwks(), {
      issuer: issuer(),
      algorithms: ["ES256", "RS256", "EdDSA"],
    });
    return claimsToUser(payload);
  } catch {
    // fall through to legacy shared secret
  }

  const secret = process.env.SUPABASE_JWT_SECRET;
  if (!secret) return null;

  try {
    const { payload } = await jwtVerify(
      token,
      new TextEncoder().encode(secret),
      {
        algorithms: ["HS256"],
        issuer: issuer(),
      },
    );
    return claimsToUser(payload);
  } catch {
    return null;
  }
}

function claimsToUser(payload: {
  sub?: string;
  email?: unknown;
}): AuthUser | null {
  const sub = payload.sub;
  if (!sub || typeof sub !== "string") return null;
  const email = typeof payload.email === "string" ? payload.email : undefined;
  return { id: sub, email };
}

export function cookieOptions(maxAgeSeconds: number) {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax" as const,
    path: "/",
    maxAge: maxAgeSeconds,
  };
}
