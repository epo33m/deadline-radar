/** Browser-side API helper (same-origin /api rewrite → Elysia). */
export async function apiBrowser<T = unknown>(
  path: string,
  init: RequestInit = {},
): Promise<T & { error?: string; fieldErrors?: Partial<Record<string, string[]>> }> {
  const headers = new Headers(init.headers);
  if (!headers.has("content-type") && init.body && !(init.body instanceof FormData)) {
    headers.set("content-type", "application/json");
  }
  const response = await fetch(path, {
    ...init,
    headers,
    credentials: "include",
  });
  const text = await response.text();
  const data = (text ? JSON.parse(text) : {}) as T & {
    error?: string;
    fieldErrors?: Partial<Record<string, string[]>>;
  };
  if (!response.ok && !data.error) {
    return { ...data, error: `Request failed (${response.status})` };
  }
  return data;
}
