/**
 * Safe `next` redirect resolution for the email-confirm flow
 * (`/auth/confirm?next=...`).
 *
 * Only internal paths actually produced/consumed by the application are
 * allowed. Everything else — protocol-relative URLs (`//evil.com`),
 * absolute URLs, `javascript:`/`data:` payloads, backslash tricks
 * (`/\evil.com`), and unlisted internal paths — falls back to `/summary`.
 *
 * Robustness comes from WHATWG URL parsing against a dummy base origin
 * (which normalizes backslashes and resolves protocol-relative inputs to an
 * external origin) combined with an explicit path allow-list, instead of a
 * bare `startsWith("/")` check.
 */
export const CONFIRM_NEXT_FALLBACK = "/summary";

/**
 * Internal `next` destinations used by the application:
 * - `/reset-password`: password-recovery links
 *   (`forgot-password` → `resetPasswordForEmail` with
 *   `redirectTo = <web-origin>/auth/confirm?next=/reset-password`)
 * - `/summary`: default landing after signup/email-change confirmation
 */
export const CONFIRM_NEXT_ALLOW_LIST = [
  "/reset-password",
  "/summary",
] as const;

const DUMMY_BASE = "http://localhost";
const DUMMY_ORIGIN = "http://localhost";

export function resolveConfirmNextPath(value: unknown): string {
  if (typeof value !== "string" || !value.startsWith("/")) {
    return CONFIRM_NEXT_FALLBACK;
  }
  let parsed: URL;
  try {
    parsed = new URL(value, DUMMY_BASE);
  } catch {
    return CONFIRM_NEXT_FALLBACK;
  }
  // Any input that escapes the dummy origin (protocol-relative `//evil.com`,
  // absolute `https://…`, `javascript:`/`data:`, backslash-as-slash
  // normalization) is rejected here.
  if (parsed.origin !== DUMMY_ORIGIN) {
    return CONFIRM_NEXT_FALLBACK;
  }
  if (
    !(
      CONFIRM_NEXT_ALLOW_LIST as readonly string[]
    ).includes(parsed.pathname)
  ) {
    return CONFIRM_NEXT_FALLBACK;
  }
  return value;
}

/**
 * Safe `return_to` redirect resolution for post-action navigation
 * (e.g. `createTask` honoring a `return_to` form field).
 *
 * Unlike {@link resolveConfirmNextPath}, there is no path allow-list here:
 * any same-origin path is accepted (`/tasks`, `/courses/:id?view=all`, …).
 * Everything that escapes the origin — protocol-relative URLs (`//evil.com`),
 * absolute URLs, `javascript:`/`data:` payloads, backslash tricks
 * (`/\evil.com`) — plus control characters (CR/LF header-splitting) and
 * non-string input falls back to the caller-supplied `fallback`
 * (normally the server-generated `redirectTo`).
 *
 * Finding SEC-001: a bare `startsWith("/")` check accepts `//evil.com`
 * (protocol-relative URL → attacker origin), so WHATWG URL parsing against
 * a dummy base origin is used instead.
 */
export function resolveSafeReturnTo(value: unknown, fallback: string): string {
  if (typeof value !== "string" || value.length === 0) {
    return fallback;
  }
  // Reject control characters (including CR/LF) before parsing.
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f]/.test(value)) {
    return fallback;
  }
  // Must start with exactly one "/" — rejects "//evil.com" and "/\evil.com"
  // even before URL normalization.
  if (!value.startsWith("/") || value.startsWith("//") || value[1] === "\\") {
    return fallback;
  }
  let parsed: URL;
  try {
    parsed = new URL(value, DUMMY_BASE);
  } catch {
    return fallback;
  }
  // Any input that escapes the dummy origin (protocol-relative, absolute,
  // scheme payload, backslash-as-slash normalization) is rejected here.
  if (parsed.origin !== DUMMY_ORIGIN) {
    return fallback;
  }
  return value;
}
