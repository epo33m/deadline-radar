import { beforeEach, describe, expect, mock, test } from "bun:test";
import type { Capability } from "./authorization/capabilities";

/**
 * End-to-end time-format scenario at the HTTP layer (real Elysia app, real
 * Zod validation, real route + authz logic). Only Supabase/DB edges are
 * mocked — the profile store below is stateful so persistence across reads,
 * format switches, and refreshes can be verified.
 */

type ProfileRow = {
  id: string;
  email: string;
  timezone: string;
  timeFormat: "24h" | "12h";
};

let profile: ProfileRow;

const getUser = mock(async () => ({
  data: { user: { id: "user-1", email: "student@example.com" } },
  error: null,
}));

mock.module("./supabase", () => ({
  createAnonClient: () => ({
    auth: {
      signInWithPassword: mock(async () => ({
        data: { session: null, user: null },
        error: { message: "Invalid login credentials" },
      })),
      signUp: mock(async () => ({
        data: { session: null, user: null },
        error: { message: "User already registered" },
      })),
      refreshSession: mock(async () => ({
        data: { session: null },
        error: { message: "Invalid Refresh Token" },
      })),
      resetPasswordForEmail: mock(async () => ({ data: {}, error: null })),
      exchangeCodeForSession: mock(async () => ({
        data: { session: null },
        error: { message: "bad" },
      })),
      verifyOtp: mock(async () => ({
        data: { session: null },
        error: { message: "bad" },
      })),
    },
  }),
  createUserClient: () => ({
    auth: {
      signOut: mock(async () => ({ error: null })),
      updateUser: mock(async () => ({
        data: { user: { id: "user-1" } },
        error: null,
      })),
      getUser,
    },
  }),
  createServiceClient: () => ({
    auth: { admin: {} },
  }),
}));

mock.module("./db", () => ({
  getDb: () => ({
    update: () => ({
      set: (patch: Partial<ProfileRow>) => ({
        where: async () => {
          profile = { ...profile, ...patch };
          return [];
        },
      }),
    }),
    select: () => ({
      from: () => ({
        where: () => ({
          limit: async () => [profile],
        }),
      }),
    }),
    insert: () => ({
      values: async () => [],
    }),
  }),
}));

mock.module("./auth-audit", () => ({
  recordAuthEvent: async () => undefined,
}));

const { resetLoginAttemptStore } = await import("./auth-abuse");
process.env.AUTH_BRIDGE_SECRET ??= "test-auth-bridge-secret";
process.env.NODE_ENV = "test";
process.env.TRUST_PROXY = "true";

const { resetRateLimitBuckets } = await import("../plugins/rate-limit");
const { setVerifyAccessTokenOverride } = await import("./auth-tokens");
const {
  setLoadAuthorizationContextOverride,
  createAuthorizationContext,
} = await import("./authorization");

// Import app after mocks are registered.
const { app } = await import("../app");

const BEARER = { authorization: "Bearer signed-in-token" };

function grant(capabilities: Capability[]) {
  setVerifyAccessTokenOverride(async () => ({
    id: "user-1",
    email: "student@example.com",
    sessionId: "sess-1",
  }));
  setLoadAuthorizationContextOverride(async (subject) =>
    createAuthorizationContext({
      subject,
      roles: ["user"],
      capabilities,
    }),
  );
}

async function getSessionTimeFormat(): Promise<string> {
  const response = await app.handle(
    new Request("http://localhost/api/v1/auth/session", {
      headers: { ...BEARER },
    }),
  );
  expect(response.status).toBe(200);
  const body = (await response.json()) as {
    user?: { timeFormat?: string };
  };
  return body.user?.timeFormat ?? "";
}

describe("time format preference end-to-end", () => {
  beforeEach(() => {
    resetLoginAttemptStore();
    resetRateLimitBuckets();
    setVerifyAccessTokenOverride(null);
    setLoadAuthorizationContextOverride(null);
    getUser.mockClear();
    profile = {
      id: "user-1",
      email: "student@example.com",
      timezone: "UTC",
      timeFormat: "24h",
    };
  });

  test("default time format is 24h", async () => {
    grant(["profile.view"]);
    expect(await getSessionTimeFormat()).toBe("24h");
  });

  test("change format to 12h persists and is visible on session read", async () => {
    grant(["profile.view", "profile.time-format.update"]);

    const patch = await app.handle(
      new Request("http://localhost/api/v1/auth/time-format", {
        method: "PATCH",
        headers: { "content-type": "application/json", ...BEARER },
        body: JSON.stringify({ timeFormat: "12h" }),
      }),
    );
    expect(patch.status).toBe(200);
    expect(await patch.json()).toEqual({ ok: true, timeFormat: "12h" });

    // Persists across reads (refresh / new device fetch the same value).
    expect(await getSessionTimeFormat()).toBe("12h");
    expect(await getSessionTimeFormat()).toBe("12h");
  });

  test("change back to 24h persists", async () => {
    grant(["profile.view", "profile.time-format.update"]);
    profile.timeFormat = "12h";

    const patch = await app.handle(
      new Request("http://localhost/api/v1/auth/time-format", {
        method: "PATCH",
        headers: { "content-type": "application/json", ...BEARER },
        body: JSON.stringify({ timeFormat: "24h" }),
      }),
    );
    expect(patch.status).toBe(200);
    expect(await getSessionTimeFormat()).toBe("24h");
  });

  test("unauthenticated update is rejected and leaves the value untouched", async () => {
    const response = await app.handle(
      new Request("http://localhost/api/v1/auth/time-format", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ timeFormat: "12h" }),
      }),
    );
    expect(response.status).toBe(401);
    expect(profile.timeFormat).toBe("24h");
  });

  test("invalid timeFormat is rejected and leaves the value untouched", async () => {
    grant(["profile.view", "profile.time-format.update"]);

    for (const bad of ["AM", "", "13h", 12, null]) {
      const response = await app.handle(
        new Request("http://localhost/api/v1/auth/time-format", {
          method: "PATCH",
          headers: { "content-type": "application/json", ...BEARER },
          body: JSON.stringify({ timeFormat: bad }),
        }),
      );
      expect(response.status).toBe(400);
    }
    expect(profile.timeFormat).toBe("24h");
  });

  test("missing capability is forbidden", async () => {
    grant(["profile.view"]);

    const response = await app.handle(
      new Request("http://localhost/api/v1/auth/time-format", {
        method: "PATCH",
        headers: { "content-type": "application/json", ...BEARER },
        body: JSON.stringify({ timeFormat: "12h" }),
      }),
    );
    expect(response.status).toBe(403);
    expect(profile.timeFormat).toBe("24h");
  });

  test("update only affects the authenticated user", async () => {
    // The route derives the user from the session — there is no user-id
    // field for a client to tamper with, so a strict body is enforced.
    grant(["profile.view", "profile.time-format.update"]);

    const response = await app.handle(
      new Request("http://localhost/api/v1/auth/time-format", {
        method: "PATCH",
        headers: { "content-type": "application/json", ...BEARER },
        body: JSON.stringify({ timeFormat: "12h", userId: "user-2" }),
      }),
    );
    expect(response.status).toBe(400);
    expect(profile.timeFormat).toBe("24h");
  });
});
