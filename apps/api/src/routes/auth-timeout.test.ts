/**
 * Finding #8 route test: a hanging Supabase Auth endpoint must not hang the
 * API. Uses a REAL supabase client pointed at a local server that accepts
 * the login request and never responds; the injected client fetch aborts it
 * after `SUPABASE_AUTH_TIMEOUT_MS`, and the route answers with the existing
 * generic 401 contract (no hang, no leak).
 */
process.env.NODE_ENV = "test";
process.env.AUTH_BRIDGE_SECRET ??= "test-auth-bridge-secret";
import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";

const savedSupabaseUrl = process.env.SUPABASE_URL;
const savedAnonKey = process.env.SUPABASE_ANON_KEY;
const savedAuthTimeout = process.env.SUPABASE_AUTH_TIMEOUT_MS;

mock.module("../lib/auth-audit", () => ({
  recordAuthEvent: async () => undefined,
}));

/**
 * mock.module is process-global in this suite: other test files mock
 * `../lib/supabase` with fakes, which would otherwise leak in here. This
 * test needs REAL supabase clients (it proves the injected fetch timeout
 * bounds a hanging provider), so it registers real factories built on the
 * actual SDK + timeout fetch. Later files register their own mocks.
 */
import { createClient } from "@supabase/supabase-js";
import { fetchWithTimeout } from "../lib/net";
import { resolveSupabaseAnonKey, resolveSupabaseUrl } from "../env";

function timeoutedFetch(timeoutMs: number): typeof fetch {
  const timed = (url: string | URL | Request, init?: RequestInit) =>
    fetchWithTimeout(url, init ?? {}, timeoutMs);
  return timed as unknown as typeof fetch;
}

function supabaseTimeoutMs(name: string, fallback: number): number {
  const raw = Number(process.env[name] ?? "");
  return Number.isFinite(raw) && raw > 0 ? raw : fallback;
}

mock.module("../lib/supabase", () => ({
  createAnonClient: () =>
    createClient(resolveSupabaseUrl(), resolveSupabaseAnonKey(), {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
        detectSessionInUrl: false,
      },
      global: {
        fetch: timeoutedFetch(supabaseTimeoutMs("SUPABASE_AUTH_TIMEOUT_MS", 10_000)),
      },
    }),
  createUserClient: (accessToken: string) =>
    createClient(resolveSupabaseUrl(), resolveSupabaseAnonKey(), {
      global: {
        headers: { Authorization: `Bearer ${accessToken}` },
        fetch: timeoutedFetch(supabaseTimeoutMs("SUPABASE_AUTH_TIMEOUT_MS", 10_000)),
      },
      auth: {
        autoRefreshToken: false,
        persistSession: false,
        detectSessionInUrl: false,
      },
    }),
  createServiceClient: () => {
    throw new Error("not used in this test");
  },
}));

mock.module("../lib/db", () => ({
  getDb: () => ({
    select: () => ({ from: () => ({ where: () => ({ limit: async () => [] }) }) }),
    update: () => ({ set: () => ({ where: async () => [] }) }),
    insert: () => ({ values: async () => [] }),
  }),
}));

const { resetLoginAttemptStore } = await import("../lib/auth-abuse");
const { resetRateLimitBuckets } = await import("../plugins/rate-limit");
const { AUTH_ERRORS } = await import("../lib/auth-errors");
const { setVerifyAccessTokenOverride } = await import("../lib/auth-tokens");
const {
  setLoadAuthorizationContextOverride,
} = await import("../lib/authorization");
const { app } = await import("../app");

let server: ReturnType<typeof Bun.serve> | null = null;

beforeEach(() => {
  resetLoginAttemptStore();
  resetRateLimitBuckets();
  // Hermetic against other test files sharing this process.
  setVerifyAccessTokenOverride(null);
  setLoadAuthorizationContextOverride(null);
  server = Bun.serve({
    port: 0,
    // Accept the auth request and never answer: the client fetch timeout
    // must bound the call.
    fetch: () => new Promise<Response>(() => {}),
  });
  process.env.SUPABASE_URL = `http://127.0.0.1:${server?.port}`;
  process.env.SUPABASE_ANON_KEY = "test-anon-key";
  process.env.SUPABASE_AUTH_TIMEOUT_MS = "300";
});

afterEach(() => {
  server?.stop(true);
  server = null;
  if (savedSupabaseUrl === undefined) delete process.env.SUPABASE_URL;
  else process.env.SUPABASE_URL = savedSupabaseUrl;
  if (savedAnonKey === undefined) delete process.env.SUPABASE_ANON_KEY;
  else process.env.SUPABASE_ANON_KEY = savedAnonKey;
  if (savedAuthTimeout === undefined) {
    delete process.env.SUPABASE_AUTH_TIMEOUT_MS;
  } else {
    process.env.SUPABASE_AUTH_TIMEOUT_MS = savedAuthTimeout;
  }
});

describe("finding #8 — hanging auth provider", () => {
  test("login against a hanging provider resolves with the generic 401", async () => {
    const started = Date.now();
    const response = await app.handle(
      new Request("http://localhost/api/v1/auth/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          email: "student@example.com",
          password: "secret12",
        }),
      }),
    );
    const elapsed = Date.now() - started;
    expect(response.status).toBe(401);
    const body = (await response.json()) as {
      error?: { code?: string; message?: string } | string;
    };
    const err = body.error;
    expect(typeof err === "string" ? err : err?.code).toBe("UNAUTHORIZED");
    expect(typeof err === "string" ? err : err?.message).toBe(
      AUTH_ERRORS.invalidCredentials,
    );
    // Bounded by the ~300ms client timeout, not by the hung upstream.
    expect(elapsed).toBeLessThan(10000);
  });
});
