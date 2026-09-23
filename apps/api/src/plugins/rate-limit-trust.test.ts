/**
 * Finding #9 route tests: spoof resistance, account throttling, fallback.
 * - A: spoofed forwarding headers grant no fresh bucket when untrusted.
 * - C: rotating IPs does not escape the account-level login throttle.
 * - D: throttling one account does not affect another.
 * - E: without Redis, the in-memory fallback still enforces limits.
 * - F: ambiguous TRUST_PROXY fails safe to untrusted.
 * - G: sensitive-endpoint thresholds still trigger (20/min).
 */
process.env.NODE_ENV = "test";
process.env.AUTH_BRIDGE_SECRET ??= "test-auth-bridge-secret";
process.env.TRUST_PROXY = "true";
import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";

const savedTrustProxy = process.env.TRUST_PROXY;
const savedRedisUrl = process.env.REDIS_URL;

const signInWithPassword = mock(async () => ({
  data: { session: null, user: null },
  error: { message: "Invalid login credentials" },
}));

const resetPasswordForEmail = mock(async () => ({
  data: {},
  error: null,
}));

mock.module("../lib/supabase", () => ({
  createAnonClient: () => ({
    auth: { signInWithPassword, resetPasswordForEmail },
  }),
  createUserClient: () => ({ auth: {} }),
  createServiceClient: () => ({ auth: { admin: {} } }),
}));

mock.module("../lib/db", () => ({
  getDb: () => ({
    update: () => ({ set: () => ({ where: async () => [] }) }),
    select: () => ({ from: () => ({ where: () => ({ limit: async () => [] }) }) }),
    insert: () => ({ values: async () => [] }),
  }),
}));

mock.module("../lib/auth-audit", () => ({
  recordAuthEvent: async () => undefined,
}));

const { resetLoginAttemptStore, resetAccountAttemptStore } = await import(
  "../lib/auth-abuse"
);
const { resetRateLimitBuckets } = await import("./rate-limit");
const { redisRateLimitStore } = await import("./rate-limit");
const { AUTH_ERRORS } = await import("../lib/auth-errors");

const { app } = await import("../app");

function loginAttempt(email: string, ip: string) {
  return app.handle(
    new Request("http://localhost/api/v1/auth/login", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-forwarded-for": ip,
      },
      body: JSON.stringify({ email, password: "wrong-password" }),
    }),
  );
}

function forgotAttempt(headers: Record<string, string>, email: string) {
  return app.handle(
    new Request("http://localhost/api/v1/auth/forgot-password", {
      method: "POST",
      headers: { "content-type": "application/json", ...headers },
      body: JSON.stringify({ email }),
    }),
  );
}

beforeEach(() => {
  resetLoginAttemptStore();
  resetAccountAttemptStore();
  resetRateLimitBuckets();
  signInWithPassword.mockClear();
  resetPasswordForEmail.mockClear();
  process.env.TRUST_PROXY = "true";
  if (savedRedisUrl === undefined) delete process.env.REDIS_URL;
  else process.env.REDIS_URL = savedRedisUrl;
});

afterEach(() => {
  if (savedTrustProxy === undefined) delete process.env.TRUST_PROXY;
  else process.env.TRUST_PROXY = savedTrustProxy;
  if (savedRedisUrl === undefined) delete process.env.REDIS_URL;
  else process.env.REDIS_URL = savedRedisUrl;
});

describe("finding #9 — rate-limit trust", () => {
  test("A. spoofed headers grant no escape when proxy trust is off", async () => {
    delete process.env.TRUST_PROXY;
    const spoofHeaders: Record<string, string>[] = [
      { "x-forwarded-for": "9.9.9.1" },
      { "x-forwarded-for": "9.9.9.2" },
      { "x-real-ip": "9.9.9.3" },
      { forwarded: "for=9.9.9.4" },
    ];
    let lastStatus = 0;
    // 20/min shared "local" bucket: rotating spoofed headers must not reset it.
    for (let i = 0; i < 21; i += 1) {
      const response = await forgotAttempt(
        spoofHeaders[i % spoofHeaders.length],
        `user${i}@example.com`,
      );
      lastStatus = response.status;
    }
    expect(lastStatus).toBe(429);
  });

  test("C. rotating IPs does not escape the account login throttle", async () => {
    const statuses: number[] = [];
    for (let i = 0; i < 10; i += 1) {
      const response = await loginAttempt("victim@example.com", `10.0.0.${i}`);
      statuses.push(response.status);
    }
    expect(statuses.every((s) => s === 401)).toBe(true);
    // 11th attempt from a brand-new IP: account bucket (10 failures) denies.
    const denied = await loginAttempt("victim@example.com", "10.9.9.9");
    expect(denied.status).toBe(429);
    const body = (await denied.json()) as {
      error?: { code?: string } | string;
    };
    const err = body.error;
    expect(typeof err === "string" ? err : err?.code).toBe("RATE_LIMITED");
  });

  test("D. throttling one account leaves another unaffected", async () => {
    for (let i = 0; i < 10; i += 1) {
      await loginAttempt("victim@example.com", `10.0.0.${i}`);
    }
    expect((await loginAttempt("victim@example.com", "10.9.9.9")).status).toBe(
      429,
    );
    const other = await loginAttempt("other@example.com", "10.9.9.9");
    expect(other.status).toBe(401);
    const body = (await other.json()) as {
      error?: { message?: string } | string;
    };
    const err = body.error;
    expect(typeof err === "string" ? err : err?.message).toBe(
      AUTH_ERRORS.invalidCredentials,
    );
  });

  test("E. memory fallback enforces limits without Redis", async () => {
    delete process.env.REDIS_URL;
    let lastStatus = 0;
    for (let i = 0; i < 21; i += 1) {
      const response = await forgotAttempt(
        { "x-forwarded-for": "8.8.8.8" },
        `user${i}@example.com`,
      );
      lastStatus = response.status;
    }
    // Still enforced per-process (not unlimited), same 20/min threshold.
    expect(lastStatus).toBe(429);
    // The Redis-backed store delegates to memory when Redis is absent.
    const store = redisRateLimitStore;
    for (let i = 0; i < 20; i += 1) {
      await store.consume("e2e-key", 20, 60_000);
    }
    const verdict = await store.consume("e2e-key", 20, 60_000);
    expect(verdict.limited).toBe(true);
  });

  test("F. ambiguous TRUST_PROXY shares one bucket (fail-safe)", async () => {
    process.env.TRUST_PROXY = "maybe";
    let lastStatus = 0;
    for (let i = 0; i < 21; i += 1) {
      const response = await forgotAttempt(
        { "x-forwarded-for": `9.9.9.${i}` },
        `user${i}@example.com`,
      );
      lastStatus = response.status;
    }
    expect(lastStatus).toBe(429);
  });

  test("G. trusted mode still keys buckets per client IP", async () => {
    // Same spoofed IP 21 times → 429 on the per-IP bucket.
    let lastStatus = 0;
    for (let i = 0; i < 21; i += 1) {
      const response = await forgotAttempt(
        { "x-forwarded-for": "7.7.7.7" },
        `user${i}@example.com`,
      );
      lastStatus = response.status;
    }
    expect(lastStatus).toBe(429);
    // A different client IP is unaffected.
    const fresh = await forgotAttempt(
      { "x-forwarded-for": "7.7.7.8" },
      "fresh@example.com",
    );
    expect(fresh.status).toBe(200);
  });
});
