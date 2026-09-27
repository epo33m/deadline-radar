import { describe, expect, test } from "bun:test";

import {
  buildContentSecurityPolicy,
  buildSecurityHeaders,
  buildStaticContentSecurityPolicy,
  HSTS_VALUE,
} from "./security-headers";

const NONCE = "dGVzdC1ub25jZQ==";

describe("buildContentSecurityPolicy (SEC-002)", () => {
  test("binds the per-request nonce with strict-dynamic, no unsafe-inline", () => {
    const csp = buildContentSecurityPolicy(NONCE, false);
    expect(csp).toContain(`'nonce-${NONCE}'`);
    expect(csp).toContain("'strict-dynamic'");
    expect(csp).not.toContain("unsafe-inline");
  });

  test("allows unsafe-eval in dev only, never in prod", () => {
    expect(buildContentSecurityPolicy(NONCE, true)).toContain("unsafe-eval");
    expect(buildContentSecurityPolicy(NONCE, false)).not.toContain(
      "unsafe-eval",
    );
  });

  test("locks framing, objects, base and form targets", () => {
    const csp = buildContentSecurityPolicy(NONCE, false);
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("object-src 'none'");
    expect(csp).toContain("base-uri 'self'");
    expect(csp).toContain("form-action 'self'");
    expect(csp).toContain("connect-src 'self' https://*.sentry.io");
  });
});

describe("buildSecurityHeaders (SEC-002)", () => {
  test("emits CSP + anti-sniffing + anti-framing headers", () => {
    const headers = buildSecurityHeaders({
      nonce: NONCE,
      isDev: false,
      isProd: true,
    });
    expect(headers["Content-Security-Policy"]).toContain(`nonce-${NONCE}`);
    expect(headers["X-Content-Type-Options"]).toBe("nosniff");
    expect(headers["Referrer-Policy"]).toBe("strict-origin-when-cross-origin");
    expect(headers["X-Frame-Options"]).toBe("DENY");
  });

  test("emits HSTS only in production", () => {
    const prod = buildSecurityHeaders({
      nonce: NONCE,
      isDev: false,
      isProd: true,
    });
    expect(prod["Strict-Transport-Security"]).toBe(HSTS_VALUE);

    const dev = buildSecurityHeaders({
      nonce: NONCE,
      isDev: true,
      isProd: false,
    });
    expect("Strict-Transport-Security" in dev).toBe(false);
  });

  test("uses the hash CSP when static hashes are provided", () => {
    const headers = buildSecurityHeaders({
      nonce: NONCE,
      isDev: false,
      isProd: true,
      staticHashes: { scripts: ["'sha256-abc'"], styles: [] },
    });
    expect(headers["Content-Security-Policy"]).toContain("'sha256-abc'");
    expect(headers["Content-Security-Policy"]).not.toContain("nonce-");
  });

  test("falls back to the nonce CSP when the static map is empty", () => {
    const headers = buildSecurityHeaders({
      nonce: NONCE,
      isDev: false,
      isProd: true,
      staticHashes: { scripts: [], styles: [] },
    });
    expect(headers["Content-Security-Policy"]).toContain(`nonce-${NONCE}`);
  });
});

describe("buildStaticContentSecurityPolicy (SEC-002 hash variant)", () => {
  const HASH = "'sha256-Zm9vYmFyMTIzNDU2Nzg5MGFiY2RlZg=='";

  test("authorizes hashes with strict-dynamic, never a nonce or unsafe-inline", () => {
    const csp = buildStaticContentSecurityPolicy([HASH], [], false);
    expect(csp).toContain(`script-src 'self' ${HASH} 'strict-dynamic'`);
    expect(csp).toContain("style-src 'self'");
    expect(csp).not.toContain("nonce-");
    expect(csp).not.toContain("unsafe-inline");
  });

  test("includes style hashes when present", () => {
    const csp = buildStaticContentSecurityPolicy([HASH], [HASH], false);
    expect(csp).toContain(`style-src 'self' ${HASH}`);
  });

  test("allows unsafe-eval in dev only, never in prod", () => {
    expect(
      buildStaticContentSecurityPolicy([HASH], [], true),
    ).toContain("unsafe-eval");
    expect(
      buildStaticContentSecurityPolicy([HASH], [], false),
    ).not.toContain("unsafe-eval");
  });

  test("keeps the same framing/object/base/form/connect locks", () => {
    const csp = buildStaticContentSecurityPolicy([HASH], [], false);
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("object-src 'none'");
    expect(csp).toContain("base-uri 'self'");
    expect(csp).toContain("form-action 'self'");
    expect(csp).toContain("connect-src 'self' https://*.sentry.io");
  });
});
