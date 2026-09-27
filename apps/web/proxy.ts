import { createRemoteJWKSet, jwtVerify } from "jose";
import { type NextRequest, NextResponse } from "next/server";

import {
  ACCESS_COOKIE,
  AUTH_BRIDGE_HEADER,
  authBridgeSecret,
  REFRESH_COOKIE,
  REFRESH_COOKIE_MAX_AGE_SECONDS,
  authCookieOptions,
  clearedAuthCookieOptions,
  type AuthTokenBody,
} from "@/lib/auth/cookies";
import { resolveSessionGate } from "@/lib/auth/session-gate";
import { STATIC_CSP_HASHES } from "@/lib/csp-hashes";
import { buildSecurityHeaders } from "@/lib/security-headers";

function supabaseUrl(): string {
  return (
    process.env.SUPABASE_URL ??
    process.env.NEXT_PUBLIC_SUPABASE_URL ??
    ""
  ).replace(/\/$/, "");
}

function issuer(): string {
  return `${supabaseUrl()}/auth/v1`;
}

function apiOrigin(): string {
  return process.env.API_ORIGIN ?? "http://127.0.0.1:4025";
}

let jwks: ReturnType<typeof createRemoteJWKSet> | null = null;

function getJwks() {
  if (!jwks) {
    jwks = createRemoteJWKSet(
      new URL(`${supabaseUrl()}/auth/v1/.well-known/jwks.json`),
    );
  }
  return jwks;
}

function clearAuthCookies(response: NextResponse) {
  response.cookies.set(ACCESS_COOKIE, "", clearedAuthCookieOptions());
  response.cookies.set(REFRESH_COOKIE, "", clearedAuthCookieOptions());
}

function applySessionCookies(
  response: NextResponse,
  data: AuthTokenBody,
): void {
  if (!data.accessToken || !data.refreshToken) return;
  response.cookies.set(
    ACCESS_COOKIE,
    data.accessToken,
    authCookieOptions(data.expiresIn ?? 60 * 60),
  );
  response.cookies.set(
    REFRESH_COOKIE,
    data.refreshToken,
    authCookieOptions(REFRESH_COOKIE_MAX_AGE_SECONDS),
  );
}

async function verifyToken(token: string): Promise<boolean> {
  const base = supabaseUrl();
  if (!base) return false;

  try {
    await jwtVerify(token, getJwks(), {
      issuer: issuer(),
      audience: "authenticated",
      algorithms: ["ES256", "RS256", "EdDSA"],
    });
    return true;
  } catch {
    // legacy HS256
  }

  const secret = process.env.SUPABASE_JWT_SECRET;
  if (!secret) return false;
  try {
    await jwtVerify(token, new TextEncoder().encode(secret), {
      algorithms: ["HS256"],
      issuer: issuer(),
      audience: "authenticated",
    });
    return true;
  } catch {
    return false;
  }
}

/**
 * Resolve session from access JWT, or silently refresh using the refresh cookie.
 */
async function resolveHasSession(request: NextRequest): Promise<{
  hasSession: boolean;
  shouldClearCookies: boolean;
  refreshTokens: AuthTokenBody | null;
}> {
  const access = request.cookies.get(ACCESS_COOKIE)?.value;
  const refresh = request.cookies.get(REFRESH_COOKIE)?.value;

  if (access) {
    const ok = await verifyToken(access);
    if (ok) {
      return {
        hasSession: true,
        shouldClearCookies: false,
        refreshTokens: null,
      };
    }
  }

  if (!refresh) {
    return {
      hasSession: false,
      shouldClearCookies: Boolean(access),
      refreshTokens: null,
    };
  }

  try {
    const upstream = await fetch(`${apiOrigin()}/api/v1/auth/refresh`, {
      method: "POST",
      headers: {
        cookie: `${REFRESH_COOKIE}=${refresh}`,
        [AUTH_BRIDGE_HEADER]: authBridgeSecret(),
        origin: process.env.WEB_ORIGIN ?? "http://127.0.0.1:3025",
      },
      cache: "no-store",
    });

    if (!upstream.ok) {
      return {
        hasSession: false,
        shouldClearCookies: true,
        refreshTokens: null,
      };
    }

    const data = (await upstream.json()) as AuthTokenBody;
    if (!data.accessToken || !data.refreshToken) {
      return {
        hasSession: false,
        shouldClearCookies: true,
        refreshTokens: null,
      };
    }

    return {
      hasSession: true,
      shouldClearCookies: false,
      refreshTokens: data,
    };
  } catch {
    return {
      hasSession: false,
      shouldClearCookies: true,
      refreshTokens: null,
    };
  }
}

export async function proxy(request: NextRequest) {
  // Static-page fast path (perf plan, Fase C): prerendered pages listed in
  // STATIC_CSP_HASHES are served with a hash-based CSP — no per-request
  // nonce, no `x-nonce` request header. The hashes authorize the exact
  // inline blocks baked at build time, so the page stays static and
  // edge-cacheable with no policy weakening. Any pathname without an entry
  // (including an empty map, e.g. plain `next build` without the hash step)
  // falls through to the nonce path below.
  const staticHashes = STATIC_CSP_HASHES[request.nextUrl.pathname];
  const useStaticCsp =
    staticHashes !== undefined && staticHashes.scripts.length > 0;

  // SEC-002: fresh nonce per request (strict CSP). `x-nonce` is consumed by
  // Next.js for its own inline scripts; the CSP response header below
  // enforces it. Must run before any early return so redirects are covered.
  // Skipped on the static path: a nonce would both force dynamic rendering
  // and go stale in the edge cache.
  const nonce = useStaticCsp
    ? ""
    : Buffer.from(crypto.randomUUID()).toString("base64");
  const isDev = process.env.NODE_ENV === "development";
  const isProd = process.env.NODE_ENV === "production";
  const securityHeaders = buildSecurityHeaders({
    nonce,
    isDev,
    isProd,
    staticHashes: useStaticCsp ? staticHashes : undefined,
  });

  const applySecurityHeaders = (response: NextResponse) => {
    for (const [name, value] of Object.entries(securityHeaders)) {
      response.headers.set(name, value);
    }
  };

  const { hasSession, shouldClearCookies, refreshTokens } =
    await resolveHasSession(request);
  const gate = resolveSessionGate({
    hasSession,
    pathname: request.nextUrl.pathname,
  });

  if (gate.action === "redirect") {
    const url = request.nextUrl.clone();
    url.pathname = gate.to;
    const response = NextResponse.redirect(url);
    if (shouldClearCookies) clearAuthCookies(response);
    else if (refreshTokens) applySessionCookies(response, refreshTokens);
    applySecurityHeaders(response);
    return response;
  }

  const requestHeaders = new Headers(request.headers);
  if (!useStaticCsp) {
    requestHeaders.set("x-nonce", nonce);
  }
  const response = NextResponse.next({
    request: { headers: requestHeaders },
  });
  if (shouldClearCookies) clearAuthCookies(response);
  else if (refreshTokens) applySessionCookies(response, refreshTokens);
  applySecurityHeaders(response);
  return response;
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|api/|openapi|health|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
