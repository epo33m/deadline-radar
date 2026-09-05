import { createRemoteJWKSet, jwtVerify, type JWTPayload } from "jose";

import { resolveSupabaseUrl } from "../env";

export const ACCESS_COOKIE = "dr_access_token";
export const REFRESH_COOKIE = "dr_refresh_token";

export const REFRESH_COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 30;

export type AuthUser = {
  id: string;
  email: string | undefined;
  /** Supabase session id from JWT `session_id` when present. */
  sessionId: string | undefined;
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

export function claimsToUser(payload: JWTPayload): AuthUser | null {
  const sub = payload.sub;
  if (!sub || typeof sub !== "string") return null;
  const email = typeof payload.email === "string" ? payload.email : undefined;
  const sessionId =
    typeof payload.session_id === "string" ? payload.session_id : undefined;
  return { id: sub, email, sessionId };
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
