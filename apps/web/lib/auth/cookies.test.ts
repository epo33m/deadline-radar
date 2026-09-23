import { describe, expect, test } from "bun:test";

import {
  authCookieOptions,
  clearedAuthCookieOptions,
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
  // process.env.NODE_ENV is read-only in Next types; go through a record.
  const env = process.env as unknown as Record<string, string | undefined>;
  function withNodeEnv<T>(value: string | undefined, fn: () => T): T {
    const saved = env["NODE_ENV"];
    try {
      if (value === undefined) delete env["NODE_ENV"];
      else env["NODE_ENV"] = value;
      return fn();
    } finally {
      if (saved === undefined) delete env["NODE_ENV"];
      else env["NODE_ENV"] = saved;
    }
  }

  test("creation: HttpOnly, explicit Lax, Path=/, no Domain", () => {
    const opts = authCookieOptions(3600);
    expect(opts.httpOnly).toBe(true);
    expect(opts.sameSite).toBe("lax");
    expect(opts.path).toBe("/");
    expect(opts.maxAge).toBe(3600);
    expect("domain" in opts).toBe(false);
  });

  test("creation: Secure in production only", () => {
    expect(withNodeEnv("development", () => authCookieOptions(60).secure)).toBe(
      false,
    );
    expect(withNodeEnv("production", () => authCookieOptions(60).secure)).toBe(
      true,
    );
  });

  test("deletion scope matches creation scope in every environment", () => {
    for (const nodeEnv of ["development", "test", "production"]) {
      withNodeEnv(nodeEnv, () => {
        const cleared = clearedAuthCookieOptions();
        const created = authCookieOptions(3600);
        expect(cleared.httpOnly).toBe(true);
        expect(cleared.path).toBe(created.path);
        expect(cleared.sameSite).toBe(created.sameSite);
        expect(cleared.secure).toBe(created.secure);
        expect(cleared.secure).toBe(nodeEnv === "production");
        expect("domain" in cleared).toBe(false);
      });
    }
  });

  test("deletion expires immediately", () => {
    expect(clearedAuthCookieOptions().maxAge).toBe(0);
  });
});
