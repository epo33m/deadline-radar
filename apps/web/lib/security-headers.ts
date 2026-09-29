/**
 * Security response headers for the web app (SEC-002).
 *
 * Pure module (no I/O, no crypto) so the policy is unit-testable.
 * Nonce generation lives in `proxy.ts`, which applies these headers to
 * every proxied response. Policy follows the official Next.js CSP guide
 * (`node_modules/next/dist/docs/.../content-security-policy.md`):
 * per-request nonce + `x-nonce` request header (consumed by Next for its
 * own inline scripts) + `strict-dynamic`.
 *
 * Why strict (no `unsafe-inline`): with a valid nonce present, modern
 * browsers ignore `unsafe-inline` anyway, so omitting it only weakens
 * legacy-browser fallback — while guaranteeing a single enforcement mode.
 * The one exception is `style-src-attr`, which is separate by design: a
 * nonce cannot authorise an inline `style` attribute, and the app ships
 * runtime-computed `style={{...}}` props. `unsafe-eval` is required in
 * development (React dev overlays) and is never emitted in production.
 */

export const HSTS_VALUE =
  "max-age=63072000; includeSubDomains; preload";

export interface SecurityHeaderOptions {
  /** Per-request base64 nonce generated in `proxy.ts`. */
  nonce: string;
  /** `true` when `NODE_ENV === "development"` (allows `unsafe-eval`). */
  isDev: boolean;
  /** `true` when `NODE_ENV === "production"` (emits HSTS). */
  isProd: boolean;
}

export function buildContentSecurityPolicy(
  nonce: string,
  isDev: boolean,
): string {
  const csp = [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${isDev ? " 'unsafe-eval'" : ""}`,
    `style-src 'self' 'nonce-${nonce}'`,
    // A nonce never matches an inline `style="..."` attribute — it only
    // authorises `<style>` blocks and nonced `<link>` tags. Components that
    // compute geometry or colour at runtime (calendar event placement,
    // progress-bar width, chart slices, menu offsets) pass `style={{...}}`,
    // so without this directive every one of them renders unstyled.
    // Scoped to attributes: `<style>` elements still require the nonce.
    "style-src-attr 'unsafe-inline'",
    "img-src 'self' blob: data:",
    "font-src 'self'",
    // Sentry error ingress (audit item 7). The SDK is disabled without
    // SENTRY_DSN, so this is inert until the owner enables it.
    "connect-src 'self' https://*.sentry.io",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    // Development serves plain HTTP on 127.0.0.1. Chromium exempts loopback
    // from this directive, WebKit/Safari does not: it upgrades every
    // stylesheet and script to https://, the TLS handshake fails against the
    // dev server, and the page renders as unstyled HTML. Same class of
    // problem as HSTS on localhost above, so it is gated the same way.
    ...(isDev ? [] : ["upgrade-insecure-requests"]),
  ].join("; ");
  return csp;
}

export function buildSecurityHeaders(
  options: SecurityHeaderOptions,
): Record<string, string> {
  const { nonce, isDev, isProd } = options;
  const headers: Record<string, string> = {
    "Content-Security-Policy": buildContentSecurityPolicy(nonce, isDev),
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "strict-origin-when-cross-origin",
    // Belt-and-suspenders with `frame-ancestors 'none'` for legacy agents.
    "X-Frame-Options": "DENY",
  };
  // HSTS on http://localhost dev origins would pin HTTPS (and with
  // `preload`, permanently) — emit only in production, mirroring the API
  // (`apps/api/src/plugins/http-policy.ts`).
  if (isProd) {
    headers["Strict-Transport-Security"] = HSTS_VALUE;
  }
  return headers;
}
