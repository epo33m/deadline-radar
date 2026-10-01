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
  isSecureRequest,
  type AuthTokenBody,
} from "@/lib/auth/cookies";
import { resolveSessionGate } from "@/lib/auth/session-gate";
import { buildSecurityHeaders } from "@/lib/security-headers";
import { resolveApiOrigin } from "@/lib/api/origin";

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
  return resolveApiOrigin();
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

function clearAuthCookies(response: NextResponse, isSecure: boolean) {
  response.cookies.set(ACCESS_COOKIE, "", clearedAuthCookieOptions(isSecure));
  response.cookies.set(REFRESH_COOKIE, "", clearedAuthCookieOptions(isSecure));
}

function applySessionCookies(
  response: NextResponse,
  data: AuthTokenBody,
  isSecure: boolean,
): void {
  if (!data.accessToken || !data.refreshToken) return;
  response.cookies.set(
    ACCESS_COOKIE,
    data.accessToken,
    authCookieOptions(data.expiresIn ?? 60 * 60, isSecure),
  );
  response.cookies.set(
    REFRESH_COOKIE,
    data.refreshToken,
    authCookieOptions(REFRESH_COOKIE_MAX_AGE_SECONDS, isSecure),
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
  // SEC-002: fresh nonce per request (strict CSP). `x-nonce` is consumed by
  // Next.js for its own inline scripts; the CSP response header below
  // enforces it. Must run before any early return so redirects are covered.
  const nonce = Buffer.from(crypto.randomUUID()).toString("base64");
  const isDev = process.env.NODE_ENV === "development";
  // TLS-dependent behavior (security headers, `Secure` cookies) keys on the
  // origin the response is served from, never on NODE_ENV (#59: `next start`
  // sets NODE_ENV=production on plain-HTTP loopback). Single derivation so
  // headers and cookies can never disagree on the origin.
  const isSecure = isSecureRequest({
    forwardedProto: request.headers.get("x-forwarded-proto"),
    protocol: request.nextUrl.protocol,
  });
  const securityHeaders = buildSecurityHeaders({ nonce, isDev, isSecure });

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
    if (shouldClearCookies) clearAuthCookies(response, isSecure);
    else if (refreshTokens)
      applySessionCookies(response, refreshTokens, isSecure);
    applySecurityHeaders(response);
    return response;
  }

  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-nonce", nonce);
  const response = NextResponse.next({
    request: { headers: requestHeaders },
  });
  if (shouldClearCookies) clearAuthCookies(response, isSecure);
  else if (refreshTokens) applySessionCookies(response, refreshTokens, isSecure);
  applySecurityHeaders(response);
  return response;
}

export const config = {
  matcher: [
    // `_next/hmr` is the dev HMR WebSocket endpoint. It was `_next/webpack-hmr`
    // until Next.js 16 renamed it (see the version-12 upgrade note in
    // next/dist/docs), so an exclusion written for the old name is silently
    // inert today.
    //
    // This guard is defensive, not the fix: Next's dev `upgradeHandler`
    // short-circuits `_next/hmr` before it ever reaches the route resolver, so
    // the proxy does not run on that socket today. Keeping it means a future
    // dev-server change that *does* route upgrades through the matcher cannot
    // silently break hot reload. If you ever remove this line expecting no
    // behaviour change, that assumption is what the line exists to protect.
    "/((?!_next/static|_next/image|_next/hmr|favicon.ico|api/|openapi|health|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
