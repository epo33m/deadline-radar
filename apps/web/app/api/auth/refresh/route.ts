import { NextResponse, type NextRequest } from "next/server";

import {
  ACCESS_COOKIE,
  AUTH_BRIDGE_HEADER,
  REFRESH_COOKIE,
  REFRESH_COOKIE_MAX_AGE_SECONDS,
  authBridgeSecret,
  authCookieOptions,
  clearedAuthCookieOptions,
  isSecureRequest,
  stripAuthTokens,
  type AuthTokenBody,
} from "@/lib/auth/cookies";

import { resolveApiOrigin } from "@/lib/api/origin";

const API_ORIGIN = resolveApiOrigin();

/** Optional same-origin refresh bridge for client-triggered renewal. */
export async function POST(request: NextRequest) {
  const upstream = await fetch(`${API_ORIGIN}/api/v1/auth/refresh`, {
    method: "POST",
    headers: {
      cookie: request.headers.get("cookie") ?? "",
      origin: process.env.WEB_ORIGIN ?? "http://127.0.0.1:3025",
      [AUTH_BRIDGE_HEADER]: authBridgeSecret(),
    },
    cache: "no-store",
  });

  const text = await upstream.text();
  let data: AuthTokenBody = {};
  try {
    data = text ? (JSON.parse(text) as AuthTokenBody) : {};
  } catch {
    data = { error: "Invalid auth response" };
  }

  const safe = stripAuthTokens(data);
  const response = NextResponse.json(safe, { status: upstream.status });
  const isSecure = isSecureRequest({
    forwardedProto: request.headers.get("x-forwarded-proto"),
    protocol: request.nextUrl.protocol,
  });

  if (data.accessToken && data.refreshToken) {
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
  } else if (!upstream.ok) {
    response.cookies.set(
      ACCESS_COOKIE,
      "",
      clearedAuthCookieOptions(isSecure),
    );
    response.cookies.set(
      REFRESH_COOKIE,
      "",
      clearedAuthCookieOptions(isSecure),
    );
  }

  return response;
}
