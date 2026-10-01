/** Browser-side API helper (same-origin /api rewrite → Elysia). */
import { normalizeApiErrorBody } from "@/lib/api/errors";

export async function apiBrowser<T = unknown>(
  path: string,
  init: RequestInit = {},
): Promise<
  T & {
    error?: string;
    fieldErrors?: Partial<Record<string, string[]>>;
    requestId?: string;
  }
> {
  const headers = new Headers(init.headers);
  if (
    !headers.has("content-type") &&
    init.body &&
    !(init.body instanceof FormData)
  ) {
    headers.set("content-type", "application/json");
  }
  const response = await fetch(path, {
    ...init,
    headers,
    credentials: "include",
  });
  const text = await response.text();
  const raw = (text ? JSON.parse(text) : {}) as Record<string, unknown>;
  const data = normalizeApiErrorBody(raw, response.status);
  return data as T & {
    error?: string;
    fieldErrors?: Partial<Record<string, string[]>>;
    requestId?: string;
  };
}
