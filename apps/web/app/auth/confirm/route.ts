import { NextResponse, type NextRequest } from "next/server";

import {
  ACCESS_COOKIE,
  AUTH_BRIDGE_HEADER,
  AUTH_BRIDGE_VALUE,
  REFRESH_COOKIE,
  REFRESH_COOKIE_MAX_AGE_SECONDS,
  authCookieOptions,
  type AuthTokenBody,
} from "@/lib/auth/cookies";

const API_ORIGIN = process.env.API_ORIGIN ?? "http://127.0.0.1:4025";

/**
 * Supabase email links hit the web origin. Exchange via API with the auth
 * bridge header so session cookies are set on the web host (not API_ORIGIN).
 */
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const target = new URL("/api/auth/confirm", API_ORIGIN);
  searchParams.forEach((value, key) => {
    target.searchParams.set(key, value);
  });

  const nextParam = searchParams.get("next");
  const next =
    nextParam && nextParam.startsWith("/") ? nextParam : "/dashboard";

  try {
    const upstream = await fetch(target.toString(), {
      method: "GET",
      headers: {
        [AUTH_BRIDGE_HEADER]: AUTH_BRIDGE_VALUE,
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

    const redirectTo =
      typeof data.redirectTo === "string" && data.redirectTo.startsWith("/")
        ? data.redirectTo
        : next;
    const response = NextResponse.redirect(new URL(redirectTo, request.url));
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
    return response;
  } catch {
    const loginUrl = new URL("/login", request.url);
    loginUrl.searchParams.set("error", "confirm");
    return NextResponse.redirect(loginUrl);
  }
}
