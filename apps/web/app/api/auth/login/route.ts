import { NextResponse, type NextRequest } from "next/server";

const API_ORIGIN = process.env.API_ORIGIN ?? "http://127.0.0.1:4025";
const ACCESS_COOKIE = "dr_access_token";
const REFRESH_COOKIE = "dr_refresh_token";

type AuthBody = {
  accessToken?: string;
  refreshToken?: string;
  expiresIn?: number;
  error?: string;
};

export async function POST(request: NextRequest) {
  const incoming = await request.text();
  const upstream = await fetch(`${API_ORIGIN}/api/auth/login`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      cookie: request.headers.get("cookie") ?? "",
      origin: process.env.WEB_ORIGIN ?? "http://127.0.0.1:3025",
    },
    body: incoming,
    cache: "no-store",
  });

  const text = await upstream.text();
  let data: AuthBody = {};
  try {
    data = text ? (JSON.parse(text) as AuthBody) : {};
  } catch {
    data = { error: "Invalid auth response" };
  }

  const response = NextResponse.json(data, { status: upstream.status });

  if (data.accessToken && data.refreshToken) {
    const secure = process.env.NODE_ENV === "production";
    response.cookies.set(ACCESS_COOKIE, data.accessToken, {
      httpOnly: true,
      secure,
      sameSite: "lax",
      path: "/",
      maxAge: data.expiresIn ?? 60 * 60,
    });
    response.cookies.set(REFRESH_COOKIE, data.refreshToken, {
      httpOnly: true,
      secure,
      sameSite: "lax",
      path: "/",
      maxAge: 60 * 60 * 24 * 30,
    });
  }

  return response;
}
