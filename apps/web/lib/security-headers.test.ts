import { describe, expect, test } from "bun:test";

import {
  buildContentSecurityPolicy,
  buildSecurityHeaders,
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
});
