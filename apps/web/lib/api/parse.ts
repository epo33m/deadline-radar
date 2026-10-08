/**
 * #140: never let an upstream response body break web-side control flow.
 *
 * `apiFetch` / `apiBrowser` used a raw `JSON.parse(text)`. When the upstream
 * answers with something that is not JSON — a Railway/Supabase deploy window
 * serving an HTML 502 page is the observed case — that threw a `SyntaxError`.
 * On a server action it rejected the action into `app/(app)/error.tsx` instead
 * of rendering the inline error, and `loadSummary` / `loadCalendarMonth` caught
 * it as a transport failure and misreported "ensure the API is running".
 *
 * Policy per response, so no caller has to reason about it:
 *
 * - 2xx + JSON        → the parsed body (unchanged).
 * - 2xx + empty body  → `{}` (unchanged; already the case).
 * - 2xx + non-JSON    → an explicit retryable error body. Returning `{}` here
 *                       would be worse than the SyntaxError it replaces: the
 *                       form actions and the auth forms read `error` and would
 *                       report a success that never happened.
 * - >=400 + non-JSON  → `{}`, so the status-aware normalizer
 *                       (`normalizeApiErrorBody`) picks the copy: an HTML 401
 *                       still reads "session expired", an HTML 502 "service
 *                       unavailable". The real status is preserved for
 *                       `loadSummary` / `loadCalendarMonth` classification.
 *
 * `errorTitle` / `errorCta` are deliberately left to the normalizer so the raw
 * and normalized shapes can never drift apart.
 *
 * Every non-JSON hit warns once per (status, content-type) — status and
 * content-type only, never the body: `text/html` points at a proxy page,
 * `application/json` at a corrupt API response.
 */
import { ERROR_COPY } from "@deadline-radar/validation";

const warned = new Set<string>();

function warnOnce(
  status: number,
  contentType: string | null,
): void {
  const key = `${status}:${contentType ?? "unknown"}`;
  if (warned.has(key)) return;
  warned.add(key);
  console.warn(
    "[api] non-JSON upstream response",
    JSON.stringify({ status, contentType: contentType ?? null }),
  );
}

/** Test-only reset for the once-per-process warning. */
export function resetApiParseWarningsForTests(): void {
  warned.clear();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/**
 * Body for a response we could not parse. See the module comment for why 2xx
 * and >=400 differ.
 */
function unparsedBody(status: number): Record<string, unknown> {
  if (status >= 400) return {};
  return {
    error: ERROR_COPY.server.serverError.message,
    isRetryable: true,
  };
}

/**
 * Parse an upstream response body into a plain object, never throwing.
 *
 * A JSON scalar (`null`, `123`, `"ok"`) is valid JSON but not a usable body —
 * it is handled like non-JSON, which also closes a latent `TypeError` on
 * `normalizeApiErrorBody(null, status)`.
 */
export function apiResponseBody(
  text: string,
  status: number,
  contentType?: string | null,
): Record<string, unknown> {
  if (text.trim().length === 0) return {};

  let parsed: unknown;
  try {
    parsed = JSON.parse(text) as unknown;
  } catch {
    warnOnce(status, contentType ?? null);
    return unparsedBody(status);
  }

  if (isRecord(parsed)) return parsed;

  warnOnce(status, contentType ?? null);
  return unparsedBody(status);
}
