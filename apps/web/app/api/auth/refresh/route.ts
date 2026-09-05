import { NextResponse, type NextRequest } from "next/server";

import {
  ACCESS_COOKIE,
  AUTH_BRIDGE_HEADER,
  AUTH_BRIDGE_VALUE,
  REFRESH_COOKIE,
  REFRESH_COOKIE_MAX_AGE_SECONDS,
  authCookieOptions,
  stripAuthTokens,
  type AuthTokenBody,
} from "@/lib/auth/cookies";

const API_ORIGIN = process.env.API_ORIGIN ?? "http://127.0.0.1:4025";

/** Optional same-origin refresh bridge for client-triggered renewal. */
export async function POST(request: NextRequest) {
  const upstream = await fetch(`${API_ORIGIN}/api/auth/refresh`, {
    method: "POST",
    headers: {
      cookie: request.headers.get("cookie") ?? "",
      origin: process.env.WEB_ORIGIN ?? "http://127.0.0.1:3025",
      [AUTH_BRIDGE_HEADER]: AUTH_BRIDGE_VALUE,
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

  if (data.accessToken && data.refreshToken) {
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
  } else if (!upstream.ok) {
    response.cookies.set(ACCESS_COOKIE, "", { httpOnly: true, path: "/", maxAge: 0 });
    response.cookies.set(REFRESH_COOKIE, "", { httpOnly: true, path: "/", maxAge: 0 });
  }

  return response;
}
