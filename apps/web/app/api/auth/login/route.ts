import { NextResponse, type NextRequest } from "next/server";

import {
  ACCESS_COOKIE,
  AUTH_BRIDGE_HEADER,
  REFRESH_COOKIE,
  REFRESH_COOKIE_MAX_AGE_SECONDS,
  authBridgeSecret,
  authCookieOptions,
  isJsonAuthRequest,
  isSameOriginAuthRequest,
  isSecureRequest,
  stripAuthTokens,
  type AuthTokenBody,
} from "@/lib/auth/cookies";

import { inboundClientFor } from "@/lib/api/client-ip";
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

async function bridgeAuthPost(
  path: string,
  request: NextRequest,
): Promise<NextResponse> {
  // #162: refuse a cross-site request BEFORE reading the body or issuing any
  // upstream fetch. A cross-site top-level form navigation otherwise installs
  // the requester's session in the victim's browser: SameSite=Lax withholds no
  // cookie here and cannot prevent a response from SETTING one.
  if (!isSameOriginAuthRequest(request)) {
    return NextResponse.json(
      { error: "Cross-origin auth request rejected" },
      { status: 403 },
    );
  }
  if (!isJsonAuthRequest(request)) {
    return NextResponse.json(
      { error: "Unsupported auth request content type" },
      { status: 415 },
    );
  }

  const incoming = await request.text();
  // #160: the 20/min auth-sensitive budget is per-client, but the API can only
  // tell callers apart when this tier supplies an identity — see
  // lib/api/client-ip.ts for why forwarding is gated.
  const inboundFor = inboundClientFor(request.headers);
  const upstream = await fetch(`${API_ORIGIN}${path}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      cookie: request.headers.get("cookie") ?? "",
      ...(inboundFor ? { "x-forwarded-for": inboundFor } : {}),
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

export async function POST(request: NextRequest) {
  return bridgeAuthPost("/api/v1/auth/login", request);
}
