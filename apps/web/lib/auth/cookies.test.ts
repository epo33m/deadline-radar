import { describe, expect, test } from "bun:test";

import {
  authCookieOptions,
  clearedAuthCookieOptions,
  isSecureRequest,
  stripAuthTokens,
  type AuthTokenBody,
} from "./cookies";

describe("stripAuthTokens", () => {
  test("removes access and refresh tokens from bridge payloads", () => {
    const input: AuthTokenBody & {
      redirectTo: string;
      user: { id: string };
    } = {
      redirectTo: "/summary",
      accessToken: "secret-access",
      refreshToken: "secret-refresh",
      expiresIn: 3600,
      user: { id: "u1" },
    };
    const safe = stripAuthTokens(input);

    expect(safe).toEqual({
      redirectTo: "/summary",
      user: { id: "u1" },
    });
    expect("accessToken" in safe).toBe(false);
    expect("refreshToken" in safe).toBe(false);
    expect("expiresIn" in safe).toBe(false);
  });
});

describe("auth cookie attributes", () => {
  test("creation: HttpOnly, explicit Lax, Path=/, no Domain", () => {
    const opts = authCookieOptions(3600, true);
    expect(opts.httpOnly).toBe(true);
    expect(opts.sameSite).toBe("lax");
    expect(opts.path).toBe("/");
    expect(opts.maxAge).toBe(3600);
    expect("domain" in opts).toBe(false);
  });

  test("creation: Secure follows the request origin, never NODE_ENV", () => {
    // Same defect family as #58/#59: gating a TLS-dependent attribute on the
    // environment emitted Secure from `next start` on plain-HTTP loopback and
    // would drop the session on any plain-HTTP non-loopback host.
    expect(authCookieOptions(60, true).secure).toBe(true);
    expect(authCookieOptions(60, false).secure).toBe(false);
  });

  test("deletion scope matches creation scope on both origins", () => {
    for (const isSecure of [true, false]) {
      const cleared = clearedAuthCookieOptions(isSecure);
      const created = authCookieOptions(3600, isSecure);
      expect(cleared.httpOnly).toBe(true);
      expect(cleared.path).toBe(created.path);
      expect(cleared.sameSite).toBe(created.sameSite);
      expect(cleared.secure).toBe(created.secure);
      expect(cleared.secure).toBe(isSecure);
      expect("domain" in cleared).toBe(false);
    }
  });

  test("deletion expires immediately", () => {
    expect(clearedAuthCookieOptions(true).maxAge).toBe(0);
    expect(clearedAuthCookieOptions(false).maxAge).toBe(0);
  });
});

describe("isSecureRequest", () => {
  test("trusts the LAST x-forwarded-proto entry (edge-written), not the client-controlled first", () => {
    expect(
      isSecureRequest({ forwardedProto: "https", protocol: "http:" }),
    ).toBe(true);
    expect(
      isSecureRequest({ forwardedProto: "http", protocol: "https:" }),
    ).toBe(false);
    // Client-injected "http" in the first slot no longer strips Secure.
    expect(
      isSecureRequest({
        forwardedProto: "http, https",
        protocol: "http:",
      }),
    ).toBe(true);
    expect(
      isSecureRequest({
        forwardedProto: "https, http",
        protocol: "https:",
      }),
    ).toBe(false);
    expect(
      isSecureRequest({ forwardedProto: "https:", protocol: "http:" }),
    ).toBe(true);
  });

  test("falls back to the request URL protocol", () => {
    expect(isSecureRequest({ protocol: "https:" })).toBe(true);
    expect(isSecureRequest({ protocol: "http:" })).toBe(false);
  });

  test("without a URL (Server Actions): loopback is plain HTTP, everything else fails closed", () => {
    for (const host of [
      "localhost:3025",
      "127.0.0.1:3025",
      "[::1]:3025",
      "localhost",
    ]) {
      expect(isSecureRequest({ host })).toBe(false);
    }
    expect(isSecureRequest({ host: "deadline-radar-web.vercel.app" })).toBe(
      true,
    );
    expect(isSecureRequest({ host: "192.168.18.135:3025" })).toBe(true);
    expect(isSecureRequest({})).toBe(true);
  });
});
