import { NextResponse, type NextRequest } from "next/server";

import {
  ACCESS_COOKIE,
  AUTH_BRIDGE_HEADER,
  REFRESH_COOKIE,
  REFRESH_COOKIE_MAX_AGE_SECONDS,
  authBridgeSecret,
  authCookieOptions,
  isSecureRequest,
  type AuthTokenBody,
} from "@/lib/auth/cookies";
import { resolveConfirmNextPath } from "@deadline-radar/validation";
import { resolveApiOrigin } from "@/lib/api/origin";

const API_ORIGIN = resolveApiOrigin();

/**
 * Supabase email links hit the web origin. Exchange via API with the auth
 * bridge header so session cookies are set on the web host (not API_ORIGIN).
 */
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const target = new URL("/api/v1/auth/confirm", API_ORIGIN);
  searchParams.forEach((value, key) => {
    target.searchParams.set(key, value);
  });

  const nextParam = searchParams.get("next");
  // Allow-listed internal path only (same helper as the API confirm
  // endpoint); attacker-controlled values fall back to /summary.
  const next = resolveConfirmNextPath(nextParam);

  try {
    const upstream = await fetch(target.toString(), {
      method: "GET",
      headers: {
        [AUTH_BRIDGE_HEADER]: authBridgeSecret(),
        origin: process.env.WEB_ORIGIN ?? "http://127.0.0.1:3025",
        cookie: request.headers.get("cookie") ?? "",
      },
      cache: "no-store",
      redirect: "manual",
    });

    const text = await upstream.text();
    let data: AuthTokenBody & { redirectTo?: string } = {};
    try {
      data = text ? (JSON.parse(text) as AuthTokenBody) : {};
    } catch {
      data = {};
    }

    if (!upstream.ok || !data.accessToken || !data.refreshToken) {
      const loginUrl = new URL("/login", request.url);
      loginUrl.searchParams.set("error", "confirm");
      return NextResponse.redirect(loginUrl);
    }

    // Defense in depth: re-validate the API-provided destination through
    // the same allow-list; fall back to the already-sanitized local `next`
    // (preserves the existing fallback behavior for missing values).
    const redirectTo =
      typeof data.redirectTo === "string"
        ? resolveConfirmNextPath(data.redirectTo)
        : next;
    const response = NextResponse.redirect(new URL(redirectTo, request.url));
    const isSecure = isSecureRequest({
      forwardedProto: request.headers.get("x-forwarded-proto"),
      protocol: request.nextUrl.protocol,
    });
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
    return response;
  } catch {
    const loginUrl = new URL("/login", request.url);
    loginUrl.searchParams.set("error", "confirm");
    return NextResponse.redirect(loginUrl);
  }
}
