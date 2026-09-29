/**
 * The proxy `matcher` decides which requests get security headers, the session
 * gate, and cookie handling. Two ways it can break are both silent:
 *
 *  - A path that *should* be excluded starts matching, so the session gate
 *    starts guarding a static asset, or the HMR socket gets handled here.
 *  - A path that *should* be guarded stops matching, so an authenticated route
 *    quietly loses its headers and gate entirely. Nothing in the app fails; the
 *    security posture just erodes.
 *
 * These assertions pin both directions against the real `config` object, so a
 * well-meaning matcher edit has to fail here rather than in a browser.
 */
import { describe, expect, test } from "bun:test";
import { unstable_doesMiddlewareMatch } from "next/experimental/testing/server";

import { config } from "./proxy";

/**
 * The bundled Next.js docs call this `unstable_doesProxyMatch`
 * (dist/docs/.../proxy.md, "Unit testing"). The export that actually exists is
 * `unstable_doesMiddlewareMatch` — the docs still use the pre-rename name.
 */
function matches(url: string): boolean {
  return unstable_doesMiddlewareMatch({ config, url });
}

describe("proxy matcher: the dev HMR endpoint is excluded", () => {
  test("does not match the HMR WebSocket endpoint", () => {
    // `_next/hmr`, not `_next/webpack-hmr` — Next.js 16 renamed it. An exclusion
    // left on the old name still reads as correct and excludes nothing, which
    // is the trap this assertion exists to catch.
    expect(matches("/_next/hmr")).toBe(false);
    expect(matches("/_next/hmr?id=1")).toBe(false);
  });
});

describe("proxy matcher: pre-existing exclusions are unchanged", () => {
  test("still excludes Next internals, public assets, and proxied backends", () => {
    const excluded = [
      "/_next/static/chunks/main.js",
      "/_next/image",
      "/favicon.ico",
      "/api/v1/courses",
      "/openapi",
      "/openapi/json",
      "/health",
    ];

    for (const url of excluded) {
      expect(matches(url), `${url} must stay excluded`).toBe(false);
    }
  });

  test("still excludes image file extensions", () => {
    const excluded = [
      "/logo.svg",
      "/hero.png",
      "/scan.jpg",
      "/photo.jpeg",
      "/anim.gif",
      "/preview.webp",
      "/nested/deep/icon.svg",
    ];

    for (const url of excluded) {
      expect(matches(url), `${url} must stay excluded`).toBe(false);
    }
  });
});

describe("proxy matcher: application routes are still guarded", () => {
  test("matches the routes that need headers, the gate, and cookies", () => {
    const guarded = [
      "/",
      "/summary",
      "/courses",
      "/tasks",
      "/calendar",
      "/settings",
      "/account",
      "/login",
      "/register",
      "/privacy",
      "/terms",
      "/courses/abc/edit",
    ];

    for (const url of guarded) {
      expect(matches(url), `${url} must stay guarded`).toBe(true);
    }
  });
});
