import { cookies, headers } from "next/headers";

import { clearedAuthCookieOptions } from "@/lib/auth/cookies";

import {
  normalizeApiErrorBody,
  type ApiErrorBody,
} from "@/lib/api/errors";

export type { ApiErrorBody, ApiErrorDetail, ApiErrorObject } from "@/lib/api/errors";
export { normalizeApiErrorBody } from "@/lib/api/errors";

const API_ORIGIN = process.env.API_ORIGIN ?? "http://127.0.0.1:4025";
const ACCESS_COOKIE = "dr_access_token";
const REFRESH_COOKIE = "dr_refresh_token";

function parseSetCookie(header: string): {
  name: string;
  value: string;
  options: {
    httpOnly?: boolean;
    secure?: boolean;
    path?: string;
    maxAge?: number;
    sameSite?: "lax" | "strict" | "none";
  };
} | null {
  const parts = header.split(";").map((p) => p.trim());
  const [nv, ...attrs] = parts;
  const eq = nv.indexOf("=");
  if (eq <= 0) return null;
  const name = nv.slice(0, eq);
  const value = nv.slice(eq + 1);
  const options: {
    httpOnly?: boolean;
    secure?: boolean;
    path?: string;
    maxAge?: number;
    sameSite?: "lax" | "strict" | "none";
  } = {};
  for (const attr of attrs) {
    const lower = attr.toLowerCase();
    if (lower === "httponly") options.httpOnly = true;
    else if (lower === "secure") options.secure = true;
    else if (lower.startsWith("path=")) options.path = attr.slice(5);
    else if (lower.startsWith("max-age="))
      options.maxAge = Number(attr.slice(8));
    else if (lower.startsWith("samesite=")) {
      const v = attr.slice(9).toLowerCase();
      if (v === "lax" || v === "strict" || v === "none") options.sameSite = v;
    }
  }
  return { name, value, options };
}

async function cookieHeader(): Promise<string> {
  const store = await cookies();
  return store
    .getAll()
    .map((c) => `${c.name}=${c.value}`)
    .join("; ");
}

function isCookieMutationForbidden(error: unknown): boolean {
  return (
    error instanceof Error &&
    /^Cookies can only be modified/.test(error.message)
  );
}

async function applySetCookies(response: Response): Promise<void> {
  const raw =
    typeof response.headers.getSetCookie === "function"
      ? response.headers.getSetCookie()
      : [];
  if (raw.length === 0) return;
  try {
    const store = await cookies();
    for (const header of raw) {
      const parsed = parseSetCookie(header);
      if (!parsed) continue;
      store.set(parsed.name, parsed.value, parsed.options);
    }
  } catch (error) {
    // Reading session cookies during an RSC render is fine, committing them is
    // not — Next only allows cookie mutations in Server Actions / Route
    // Handlers. Skip silently; the next action call can persist them.
    if (!isCookieMutationForbidden(error)) throw error;
  }
}

/** Drop stale auth cookies so middleware cannot loop on invalid JWTs. */
export async function clearLocalAuthCookies(): Promise<void> {
  try {
    const store = await cookies();
    // Explicit expired-cookie scope (not store.delete): must match the
    // creation attributes or production Secure cookies survive logout.
    store.set(ACCESS_COOKIE, "", clearedAuthCookieOptions());
    store.set(REFRESH_COOKIE, "", clearedAuthCookieOptions());
  } catch (error) {
    if (!isCookieMutationForbidden(error)) throw error;
  }
}

export async function apiFetch<T = unknown>(
  path: string,
  init: RequestInit = {},
): Promise<{ data: T; response: Response }> {
  const headerStore = await headers();
  const cookie = await cookieHeader();
  const headersInit = new Headers(init.headers);
  if (cookie) headersInit.set("cookie", cookie);
  if (
    !headersInit.has("content-type") &&
    init.body &&
    !(init.body instanceof FormData)
  ) {
    headersInit.set("content-type", "application/json");
  }
  const fwdHost =
    headerStore.get("x-forwarded-host") ?? headerStore.get("host");
  if (fwdHost) headersInit.set("x-forwarded-host", fwdHost);
  const fwdProto = headerStore.get("x-forwarded-proto") ?? "http";
  headersInit.set("x-forwarded-proto", fwdProto);
  headersInit.set("origin", process.env.WEB_ORIGIN ?? "http://127.0.0.1:3025");

  const response = await fetch(`${API_ORIGIN}${path}`, {
    ...init,
    headers: headersInit,
    cache: "no-store",
  });

  await applySetCookies(response);

  if (response.status === 401) {
    await clearLocalAuthCookies();
  }

  const text = await response.text();
  const data = (text ? JSON.parse(text) : {}) as T;
  return { data, response };
}

export async function apiJson<T = unknown>(
  path: string,
  init: RequestInit = {},
): Promise<T & ApiErrorBody> {
  const { data, response } = await apiFetch<T & Record<string, unknown>>(
    path,
    init,
  );
  const normalized = normalizeApiErrorBody(data);
  if (!response.ok && !normalized.error) {
    return {
      ...normalized,
      error: `Request failed (${response.status})`,
    } as T & ApiErrorBody;
  }
  return normalized as T & ApiErrorBody;
}
