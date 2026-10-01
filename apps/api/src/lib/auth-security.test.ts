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
import { claimsToUser, clearedCookieOptions, cookieOptions, isRecoverySession } from "./auth-tokens";

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

describe("isRecoverySession", () => {
  test("accepts object amr format with recovery method", () => {
    expect(
      isRecoverySession({
        sub: "user-1",
        amr: [{ method: "recovery", timestamp: 1700000000 }],
      }),
    ).toBe(true);
  });

  test("accepts RFC-8176 string amr format", () => {
    expect(isRecoverySession({ sub: "user-1", amr: ["recovery"] })).toBe(true);
  });

  test("accepts recovery mixed with other methods", () => {
    expect(
      isRecoverySession({
        sub: "user-1",
        amr: [
          { method: "password", timestamp: 1700000000 },
          { method: "recovery", timestamp: 1700000001 },
        ],
      }),
    ).toBe(true);
  });

  test("rejects a normal login session", () => {
    expect(
      isRecoverySession({
        sub: "user-1",
        amr: [{ method: "password", timestamp: 1700000000 }],
      }),
    ).toBe(false);
  });

  test("rejects missing, null, and malformed amr (fail-closed)", () => {
    expect(isRecoverySession({ sub: "user-1" })).toBe(false);
    expect(isRecoverySession(null)).toBe(false);
    expect(isRecoverySession(undefined)).toBe(false);
    expect(isRecoverySession({ sub: "user-1", amr: "recovery" })).toBe(false);
    expect(isRecoverySession({ sub: "user-1", amr: [] })).toBe(false);
    expect(
      isRecoverySession({ sub: "user-1", amr: [{ method: "Recovery" }] }),
    ).toBe(false);
    expect(isRecoverySession({ sub: "user-1", amr: [null] })).toBe(false);
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

  test("secure follows production only, never sets Domain", () => {
    const saved = process.env.NODE_ENV;
    try {
      process.env.NODE_ENV = "development";
      expect(cookieOptions(60).secure).toBe(false);
      process.env.NODE_ENV = "production";
      expect(cookieOptions(60).secure).toBe(true);
    } finally {
      if (saved === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = saved;
    }
    expect("domain" in cookieOptions(60)).toBe(false);
  });
});

describe("clearedCookieOptions", () => {
  test("deletion scope matches creation scope", () => {
    const saved = process.env.NODE_ENV;
    try {
      for (const nodeEnv of ["development", "production"] as const) {
        process.env.NODE_ENV = nodeEnv;
        const cleared = clearedCookieOptions();
        const created = cookieOptions(3600);
        // Name+Domain+Path must match for browsers to remove the cookie;
        // Secure must match or a Secure cookie survives logout.
        expect(cleared.httpOnly).toBe(true);
        expect(cleared.path).toBe(created.path);
        expect(cleared.sameSite).toBe(created.sameSite);
        expect(cleared.secure).toBe(created.secure);
        expect(cleared.secure).toBe(nodeEnv === "production");
        expect("domain" in cleared).toBe(false);
      }
    } finally {
      if (saved === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = saved;
    }
  });

  test("deletion expires immediately", () => {
    const cleared = clearedCookieOptions();
    expect(cleared.maxAge).toBe(0);
    expect(cleared.expires instanceof Date).toBe(true);
    expect((cleared.expires as Date).getTime()).toBeLessThanOrEqual(Date.now());
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
    expect(AUTH_ERRORS.invalidCredentials).toBe(
      "The email or password doesn't match our records.",
    );
    expect(AUTH_ERRORS.invalidCredentials.toLowerCase()).not.toContain(
      "does not exist",
    );
  });
});

describe("login abuse progressive delay", () => {
  beforeEach(() => {
    resetLoginAttemptStore();
  });

  test("does not delay before the failure threshold", async () => {
    const key = loginAttemptKey("user@example.com", "1.1.1.1");
    expect(await recordLoginFailure(key)).toBe(0);
    expect(await recordLoginFailure(key)).toBe(0);
    expect(await getLoginDelayMs(key)).toBe(0);
  });

  test("applies progressive delay after repeated failures", async () => {
    const key = loginAttemptKey("user@example.com", "1.1.1.1");
    await recordLoginFailure(key);
    await recordLoginFailure(key);
    const delay = await recordLoginFailure(key);
    expect(delay).toBeGreaterThan(0);
    expect(await getLoginDelayMs(key)).toBeGreaterThan(0);
  });

  test("clears failures after success", async () => {
    const key = loginAttemptKey("user@example.com", "1.1.1.1");
    await recordLoginFailure(key);
    await recordLoginFailure(key);
    await recordLoginFailure(key);
    await clearLoginFailures(key);
    expect(await getLoginDelayMs(key)).toBe(0);
  });
});

describe("M6-M-2 — Distributed Redis auth throttle", () => {
  const redisStore = new Map<string, string>();
  const mockRedis = {
    async get(key: string) {
      return redisStore.get(key) ?? null;
    },
    async set(key: string, value: string) {
      redisStore.set(key, value);
      return "OK";
    },
    async del(key: string) {
      redisStore.delete(key);
      return 1;
    },
    async incr(key: string) {
      const cur = parseInt(redisStore.get(key) ?? "0", 10);
      const next = cur + 1;
      redisStore.set(key, String(next));
      return next;
    },
    async pexpire() {
      return 1;
    },
  };

  test("uses Redis store when available for shared rate limiting across nodes", async () => {
    const { setAbuseRedisForTests } = await import("./auth-abuse");
    setAbuseRedisForTests(mockRedis as never);
    redisStore.clear();

    const key = loginAttemptKey("cluster-user@example.com", "10.0.0.1");
    expect(await recordLoginFailure(key)).toBe(0);
    expect(await recordLoginFailure(key)).toBe(0);
    const delay = await recordLoginFailure(key);
    expect(delay).toBeGreaterThan(0);
    expect(redisStore.size).toBeGreaterThan(0);
    expect(await getLoginDelayMs(key)).toBeGreaterThan(0);

    await clearLoginFailures(key);
    expect(await getLoginDelayMs(key)).toBe(0);

    // Reset back to in-memory for subsequent tests
    setAbuseRedisForTests(null);
  });
});
