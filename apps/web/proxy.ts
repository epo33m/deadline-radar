import { createRemoteJWKSet, jwtVerify } from "jose";
import { type NextRequest, NextResponse } from "next/server";

import { resolveSessionGate } from "@/lib/auth/session-gate";

export const ACCESS_COOKIE = "dr_access_token";
export const REFRESH_COOKIE = "dr_refresh_token";

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
  response.cookies.set(ACCESS_COOKIE, "", {
    httpOnly: true,
    path: "/",
    maxAge: 0,
  });
  response.cookies.set(REFRESH_COOKIE, "", {
    httpOnly: true,
    path: "/",
    maxAge: 0,
  });
}

async function verifyToken(token: string): Promise<boolean> {
  const base = supabaseUrl();
  if (!base) return false;

  try {
    await jwtVerify(token, getJwks(), {
      issuer: issuer(),
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
    });
    return true;
  } catch {
    return false;
  }
}

/** Only treat the access cookie as a session if the JWT verifies. */
async function resolveHasSession(
  request: NextRequest,
): Promise<{ hasSession: boolean; shouldClearCookies: boolean }> {
  const token = request.cookies.get(ACCESS_COOKIE)?.value;
  if (!token) {
    return { hasSession: false, shouldClearCookies: false };
  }

  const ok = await verifyToken(token);
  if (ok) return { hasSession: true, shouldClearCookies: false };
  return { hasSession: false, shouldClearCookies: true };
}

export async function proxy(request: NextRequest) {
  const { hasSession, shouldClearCookies } = await resolveHasSession(request);
  const gate = resolveSessionGate({
    hasSession,
    pathname: request.nextUrl.pathname,
  });

  if (gate.action === "redirect") {
    const url = request.nextUrl.clone();
    url.pathname = gate.to;
    const response = NextResponse.redirect(url);
    if (shouldClearCookies) clearAuthCookies(response);
    return response;
  }

  const response = NextResponse.next();
  if (shouldClearCookies) clearAuthCookies(response);
  return response;
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|api/|openapi|health|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
