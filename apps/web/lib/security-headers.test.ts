import { describe, expect, test } from "bun:test";

import {
  buildContentSecurityPolicy,
  buildSecurityHeaders,
  buildStaticContentSecurityPolicy,
  HSTS_VALUE,
} from "./security-headers";

const NONCE = "dGVzdC1ub25jZQ==";

describe("buildContentSecurityPolicy (SEC-002)", () => {
  test("binds the per-request nonce with strict-dynamic, and confines unsafe-inline to style attributes", () => {
    const csp = buildContentSecurityPolicy(NONCE, {
      isDev: false,
      isSecure: true,
    });
    expect(csp).toContain(`'nonce-${NONCE}'`);
    expect(csp).toContain("'strict-dynamic'");
    // `unsafe-inline` may appear only in `style-src-attr`; every other
    // directive (script-src, style-src) must stay nonce-gated.
    expect(csp.replace(/style-src-attr 'unsafe-inline'/g, "")).not.toContain(
      "unsafe-inline",
    );
  });

  test("permits inline style attributes without loosening style-src", () => {
    // `style={{...}}` props are unnonceable; the attribute scope keeps
    // <style> elements behind the nonce.
    for (const isDev of [false, true]) {
      const csp = buildContentSecurityPolicy(NONCE, { isDev, isSecure: true });
      expect(csp).toContain("style-src-attr 'unsafe-inline'");
      expect(csp).toMatch(/style-src 'self' 'nonce-[^']+'/);
      expect(csp).not.toMatch(/style-src 'self'[^;]*unsafe-inline/);
    }
  });

  test("allows unsafe-eval in dev only, never in prod", () => {
    expect(
      buildContentSecurityPolicy(NONCE, { isDev: true, isSecure: false }),
    ).toContain("unsafe-eval");
    expect(
      buildContentSecurityPolicy(NONCE, { isDev: false, isSecure: true }),
    ).not.toContain("unsafe-eval");
  });

  test("locks framing, objects, base and form targets", () => {
    const csp = buildContentSecurityPolicy(NONCE, {
      isDev: false,
      isSecure: true,
    });
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("object-src 'none'");
    expect(csp).toContain("base-uri 'self'");
    expect(csp).toContain("form-action 'self'");
    expect(csp).toContain("connect-src 'self' https://*.sentry.io");
  });

  test("emits upgrade-insecure-requests only on a TLS origin, never on plain HTTP", () => {
    // #58: gating this on NODE_ENV emitted the directive from `next start` on
    // plain-HTTP loopback, and WebKit (unlike Chromium) does not exempt
    // loopback — every subresource was upgraded to https:// and the client
    // runtime never attached. The rule is the origin the response is served
    // from, in both environments.
    for (const isDev of [false, true]) {
      expect(
        buildContentSecurityPolicy(NONCE, { isDev, isSecure: true }),
      ).toContain("upgrade-insecure-requests");
      expect(
        buildContentSecurityPolicy(NONCE, { isDev, isSecure: false }),
      ).not.toContain("upgrade-insecure-requests");
    }
  });
});

describe("buildSecurityHeaders (SEC-002)", () => {
  test("emits CSP + anti-sniffing + anti-framing headers", () => {
    const headers = buildSecurityHeaders({
      nonce: NONCE,
      isDev: false,
      isSecure: true,
    });
    expect(headers["Content-Security-Policy"]).toContain(`nonce-${NONCE}`);
    expect(headers["X-Content-Type-Options"]).toBe("nosniff");
    expect(headers["Referrer-Policy"]).toBe("strict-origin-when-cross-origin");
    expect(headers["X-Frame-Options"]).toBe("DENY");
  });

  test("emits HSTS only on a TLS origin", () => {
    // Same wrong gate as upgrade-insecure-requests had (#58): `isProd` alone
    // emits HSTS from `next start` on plain-HTTP loopback. Loopback is not a
    // secure origin so nothing pins today, but `includeSubDomains; preload`
    // must never be served over plain HTTP.
    for (const isDev of [false, true]) {
      const secure = buildSecurityHeaders({
        nonce: NONCE,
        isDev,
        isSecure: true,
      });
      expect(secure["Strict-Transport-Security"]).toBe(HSTS_VALUE);

      const plain = buildSecurityHeaders({
        nonce: NONCE,
        isDev,
        isSecure: false,
      });
      expect("Strict-Transport-Security" in plain).toBe(false);
    }
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
