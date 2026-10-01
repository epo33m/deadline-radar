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
  /**
   * `true` when the response is served over TLS. Derived per request in
   * `proxy.ts` from `x-forwarded-proto` falling back to the request URL —
   * never from `NODE_ENV` (#59: gating TLS-dependent directives on the
   * environment emitted them from `next start` on plain-HTTP loopback).
   */
  isSecure: boolean;
}

export interface ContentSecurityPolicyOptions {
  /** `true` when `NODE_ENV === "development"` (allows `unsafe-eval`). */
  isDev: boolean;
  /** `true` when the response is served over TLS. See `SecurityHeaderOptions`. */
  isSecure: boolean;
}

export function buildContentSecurityPolicy(
  nonce: string,
  options: ContentSecurityPolicyOptions,
): string {
  const { isDev, isSecure } = options;
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
    // TLS-dependent directive: emit only when the response is actually served
    // over TLS. Gating this on the environment is the #58 defect — `next
    // start` sets NODE_ENV=production while serving plain HTTP on loopback,
    // and WebKit (unlike Chromium) does not exempt loopback: it upgrades every
    // stylesheet and script to https://, the handshake fails, and no client
    // runtime ever attaches.
    ...(isSecure ? ["upgrade-insecure-requests"] : []),
  ].join("; ");
  return csp;
}

/**
 * Hash-based CSP for prerendered-static pages (perf plan, Fase C).
 *
 * Same policy shape as the nonce variant, but the per-request nonce is
 * replaced by the SHA-256 hashes of the page's own inline blocks (derived
 * at build time by `scripts/build-csp-hashes.ts`). Hashes are as strong as
 * nonces for byte-identical content — which is exactly what a prerendered
 * page is — and unlike a nonce they do not force dynamic rendering, so the
 * page stays static and edge-cacheable.
 *
 * `strict-dynamic` is kept: the hashed bootstrap is the trust root and the
 * chunks it loads inherit trust; legacy browsers fall back to `'self'`,
 * which still covers the external `/_next/static` chunks.
 */
export function buildStaticContentSecurityPolicy(
  scriptHashes: string[],
  styleHashes: string[],
  isDev: boolean,
): string {
  const csp = [
    "default-src 'self'",
    `script-src 'self'${scriptHashes.length > 0 ? ` ${scriptHashes.join(" ")}` : ""} 'strict-dynamic'${isDev ? " 'unsafe-eval'" : ""}`,
    `style-src 'self'${styleHashes.length > 0 ? ` ${styleHashes.join(" ")}` : ""}`,
    "img-src 'self' blob: data:",
    "font-src 'self'",
    "connect-src 'self' https://*.sentry.io",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    "upgrade-insecure-requests",
  ].join("; ");
  return csp;
}

export function buildSecurityHeaders(
  options: SecurityHeaderOptions,
): Record<string, string> {
  const { nonce, isDev, isSecure } = options;
  const headers: Record<string, string> = {
    "Content-Security-Policy": buildContentSecurityPolicy(nonce, {
      isDev,
      isSecure,
    }),
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "strict-origin-when-cross-origin",
    // Belt-and-suspenders with `frame-ancestors 'none'` for legacy agents.
    "X-Frame-Options": "DENY",
  };
  // Same rule as upgrade-insecure-requests above: HSTS (with
  // `includeSubDomains; preload`) must never be served over plain HTTP.
  // `isProd` alone was the same defect — `next start` on loopback emitted it.
  if (isSecure) {
    headers["Strict-Transport-Security"] = HSTS_VALUE;
  }
  return headers;
}
