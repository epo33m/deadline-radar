import { NextResponse, type NextRequest } from "next/server";

import {
  ACCESS_COOKIE,
  AUTH_BRIDGE_HEADER,
  REFRESH_COOKIE,
  REFRESH_COOKIE_MAX_AGE_SECONDS,
  authBridgeSecret,
  authCookieOptions,
  isSecureRequest,
  stripAuthTokens,
  type AuthTokenBody,
} from "@/lib/auth/cookies";

import { resolveApiOrigin } from "@/lib/api/origin";

const API_ORIGIN = resolveApiOrigin();

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

export async function POST(request: NextRequest) {
  const incoming = await request.text();
  const upstream = await fetch(`${API_ORIGIN}/api/v1/auth/register`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      cookie: request.headers.get("cookie") ?? "",
      origin: process.env.WEB_ORIGIN ?? "http://127.0.0.1:3025",
      [AUTH_BRIDGE_HEADER]: authBridgeSecret(),
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
  const isSecure = isSecureRequest({
    forwardedProto: request.headers.get("x-forwarded-proto"),
    protocol: request.nextUrl.protocol,
  });
  applySessionCookies(response, data, isSecure);
  return response;
}
