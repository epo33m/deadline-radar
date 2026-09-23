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

/**
 * JWKS hardening (Finding #8), on top of jose's built-in behavior:
 * - `timeoutDuration`: an unresponsive JWKS endpoint aborts instead of
 *   hanging token verification (overridable via `JWKS_TIMEOUT_MS`, used by
 *   tests to avoid slow failure paths).
 * - `cacheMaxAge` (10 min): verified keys are reused without refetching.
 * - `cooldownDuration` (30 s): failed/empty refreshes are not retried in a
 *   hot loop, and concurrent verifications share one in-flight fetch
 *   (jose `pendingFetch` single-flight).
 * - A failed refresh never poisons the cache: jose only replaces the key
 *   set on success, so a previously valid cache keeps serving while the
 *   endpoint is down; with no usable keys verification fails closed.
 */
function jwksTimeoutMs(): number {
  const raw = Number(process.env.JWKS_TIMEOUT_MS ?? "");
  return Number.isFinite(raw) && raw > 0 ? raw : 8000;
}

export function getJwksOptions() {
  return {
    timeoutDuration: jwksTimeoutMs(),
    cacheMaxAge: 600_000,
    cooldownDuration: 30_000,
  };
}

function getJwks() {
  if (!jwks) {
    const base = resolveSupabaseUrl().replace(/\/$/, "");
    jwks = createRemoteJWKSet(
      new URL(`${base}/auth/v1/.well-known/jwks.json`),
      getJwksOptions(),
    );
  }
  return jwks;
}

/** Test-only hook to drop the cached JWKS (e.g. point at a local server). */
export function resetJwksCache(): void {
  jwks = null;
}

function issuer(): string {
  return `${resolveSupabaseUrl().replace(/\/$/, "")}/auth/v1`;
}

/**
 * Verify Supabase access tokens.
 * New projects use asymmetric ES256 via JWKS; legacy HS256 JWT secret is a fallback.
 */
type VerifyFn = (token: string) => Promise<AuthUser | null>;

let verifyAccessTokenOverride: VerifyFn | null = null;

/** Test-only hook so route suites can inject identity without JWKS. */
export function setVerifyAccessTokenOverride(fn: VerifyFn | null): void {
  verifyAccessTokenOverride = fn;
}

type VerifyClaimsFn = (token: string) => Promise<JWTPayload | null>;

let verifyAccessTokenClaimsOverride: VerifyClaimsFn | null = null;

/** Test-only hook so route suites can inject verified JWT claims without JWKS. */
export function setVerifyAccessTokenClaimsOverride(
  fn: VerifyClaimsFn | null,
): void {
  verifyAccessTokenClaimsOverride = fn;
}

/**
 * Verify a Supabase access token and return its claims.
 * Signature, issuer, and expiry are enforced by `jwtVerify` (fail-closed → null).
 */
export async function verifyAccessTokenClaims(
  token: string,
): Promise<JWTPayload | null> {
  if (verifyAccessTokenClaimsOverride) {
    return verifyAccessTokenClaimsOverride(token);
  }

  try {
    const { payload } = await jwtVerify(token, getJwks(), {
      issuer: issuer(),
      audience: "authenticated",
      algorithms: ["ES256", "RS256", "EdDSA"],
    });
    return payload;
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
        audience: "authenticated",
      },
    );
    return payload;
  } catch {
    return null;
  }
}

/**
 * Recovery-scoped session check for privileged endpoints (e.g. reset-password).
 *
 * Supabase Auth marks sessions established through the password-recovery flow
 * (`forgot-password` → recovery link → `exchangeCodeForSession` / `verifyOtp`
 * with `type: "recovery"`) with an `amr` claim containing `{ method: "recovery" }`
 * (see Supabase "JWT Claims Reference"; supported in both object and RFC-8176
 * string forms by @supabase/auth-js `JwtPayload.amr`). A normal login session
 * carries `amr: [{ method: "password", ... }]` instead.
 *
 * Fail-closed: missing, malformed, or non-recovery `amr` returns false.
 * This only inspects the already signature-verified payload — it never trusts
 * client-supplied body/query/header values.
 */
export function isRecoverySession(
  payload: JWTPayload | null | undefined,
): boolean {
  const amr: unknown = payload?.amr;
  if (!Array.isArray(amr)) return false;
  return amr.some((entry: unknown) => {
    if (typeof entry === "string") return entry === "recovery";
    if (entry !== null && typeof entry === "object" && "method" in entry) {
      return (entry as { method?: unknown }).method === "recovery";
    }
    return false;
  });
}

export async function verifyAccessToken(
  token: string,
): Promise<AuthUser | null> {
  if (verifyAccessTokenOverride) {
    return verifyAccessTokenOverride(token);
  }

  const payload = await verifyAccessTokenClaims(token);
  return payload ? claimsToUser(payload) : null;
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

/**
 * Deletion scope must match creation scope (Finding #12): browsers only
 * remove a cookie when name + domain + path match, and a `Secure` cookie
 * cannot be cleared by a non-`Secure` Set-Cookie. Framework `remove()`
 * helpers do not guarantee those attributes, so deletion is explicit.
 * No `Domain` is set on creation, so none is set here (host-only cookies).
 */
export function clearedCookieOptions() {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax" as const,
    path: "/",
    maxAge: 0,
    expires: new Date(0),
  };
}
