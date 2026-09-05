process.env.AUTH_BRIDGE_SECRET ??= "test-auth-bridge-secret";
import { beforeEach, describe, expect, test } from "bun:test";

import {
  clearLoginFailures,
  getLoginDelayMs,
  loginAttemptKey,
  recordLoginFailure,
  resetLoginAttemptStore,
} from "./auth-abuse";
import { withBridgeTokens } from "./auth-bridge";
import { AUTH_ERRORS } from "./auth-errors";
import { claimsToUser, cookieOptions } from "./auth-tokens";

describe("claimsToUser", () => {
  test("maps sub, email, and session_id into AuthUser", () => {
    expect(
      claimsToUser({
        sub: "user-1",
        email: "a@example.com",
        session_id: "sess-1",
      }),
    ).toEqual({
      id: "user-1",
      email: "a@example.com",
      sessionId: "sess-1",
    });
  });

  test("returns null without sub", () => {
    expect(claimsToUser({ email: "a@example.com" })).toBeNull();
  });
});

describe("cookieOptions", () => {
  test("sets httpOnly, lax SameSite, and path", () => {
    const opts = cookieOptions(3600);
    expect(opts.httpOnly).toBe(true);
    expect(opts.sameSite).toBe("lax");
    expect(opts.path).toBe("/");
    expect(opts.maxAge).toBe(3600);
  });
});

describe("withBridgeTokens", () => {
  test("omits tokens when not a bridge request", () => {
    const body = withBridgeTokens(
      { ok: true },
      {
        accessToken: "a",
        refreshToken: "r",
        expiresIn: 60,
      },
      false,
    );
    expect(body).toEqual({ ok: true });
  });

  test("includes tokens for bridge requests", () => {
    const body = withBridgeTokens(
      { ok: true },
      {
        accessToken: "a",
        refreshToken: "r",
        expiresIn: 60,
      },
      true,
    );
    expect(body).toEqual({
      ok: true,
      accessToken: "a",
      refreshToken: "r",
      expiresIn: 60,
    });
  });
});

describe("AUTH_ERRORS", () => {
  test("uses generic credential messaging", () => {
    expect(AUTH_ERRORS.invalidCredentials).toBe("Invalid credentials.");
    expect(AUTH_ERRORS.invalidCredentials.toLowerCase()).not.toContain(
      "does not exist",
    );
  });
});

describe("login abuse progressive delay", () => {
  beforeEach(() => {
    resetLoginAttemptStore();
  });

  test("does not delay before the failure threshold", () => {
    const key = loginAttemptKey("user@example.com", "1.1.1.1");
    expect(recordLoginFailure(key)).toBe(0);
    expect(recordLoginFailure(key)).toBe(0);
    expect(getLoginDelayMs(key)).toBe(0);
  });

  test("applies progressive delay after repeated failures", () => {
    const key = loginAttemptKey("user@example.com", "1.1.1.1");
    recordLoginFailure(key);
    recordLoginFailure(key);
    const delay = recordLoginFailure(key);
    expect(delay).toBeGreaterThan(0);
    expect(getLoginDelayMs(key)).toBeGreaterThan(0);
  });

  test("clears failures after success", () => {
    const key = loginAttemptKey("user@example.com", "1.1.1.1");
    recordLoginFailure(key);
    recordLoginFailure(key);
    recordLoginFailure(key);
    clearLoginFailures(key);
    expect(getLoginDelayMs(key)).toBe(0);
  });
});
