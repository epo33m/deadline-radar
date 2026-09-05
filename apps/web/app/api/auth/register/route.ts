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

export async function POST(request: NextRequest) {
  const incoming = await request.text();
  const upstream = await fetch(`${API_ORIGIN}/api/auth/register`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      cookie: request.headers.get("cookie") ?? "",
      origin: process.env.WEB_ORIGIN ?? "http://127.0.0.1:3025",
      [AUTH_BRIDGE_HEADER]: AUTH_BRIDGE_VALUE,
    },
    body: incoming,
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
  applySessionCookies(response, data);
  return response;
}
