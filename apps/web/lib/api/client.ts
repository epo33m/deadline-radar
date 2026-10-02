/** Browser-side API helper (same-origin /api rewrite → Elysia). */
import { normalizeApiErrorBody } from "@/lib/api/errors";
import {
  createApiTimeout,
  isAbortError,
  resolveApiTimeoutMs,
  timeoutErrorBody,
  type ApiTimeoutOptions,
} from "@/lib/api/timeout";

export async function apiBrowser<T = unknown>(
  path: string,
  init: RequestInit = {},
  options: ApiTimeoutOptions = {},
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
  // I-04: bounded by default; a caller signal (navigation/unmount) is
  // combined, never replaced.
  const callerSignal = init.signal ?? options.signal ?? null;
  const { signal, didTimeout } = createApiTimeout(
    callerSignal,
    resolveApiTimeoutMs(init, options),
  );
  let response: Response;
  try {
    response = await fetch(path, {
      ...init,
      signal,
      headers,
      credentials: "include",
    });
  } catch (error) {
    // Our own timeout → classified timeout body (retryable CTA, distinct
    // from 5xx). A caller navigation cancel rethrows so unmounted callers
    // never render a timeout; other transport failures propagate unchanged.
    if (isAbortError(error)) {
      if (didTimeout()) {
        return timeoutErrorBody() as T & {
          error?: string;
          fieldErrors?: Partial<Record<string, string[]>>;
          requestId?: string;
        };
      }
      throw error;
    }
    throw error;
  }
  const text = await response.text();
  const raw = (text ? JSON.parse(text) : {}) as Record<string, unknown>;
  const data = normalizeApiErrorBody(raw, response.status);
  return data as T & {
    error?: string;
    fieldErrors?: Partial<Record<string, string[]>>;
    requestId?: string;
  };
}
