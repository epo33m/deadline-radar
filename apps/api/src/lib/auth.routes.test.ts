import { beforeEach, describe, expect, mock, test } from "bun:test";

const signInWithPassword = mock(
  async (_args: { email: string; password: string }) =>
    ({
      data: { session: null, user: null },
      error: { message: "Invalid login credentials" },
    }) as {
      data: {
        session: {
          access_token: string;
          refresh_token: string;
          expires_in: number;
        } | null;
        user: { id: string; email: string } | null;
      };
      error: { message: string } | null;
    },
);

const signUp = mock(async () => ({
  data: { session: null, user: null },
  error: { message: "User already registered" },
}));

const refreshSession = mock(
  async (): Promise<{
    data: {
      session: {
        access_token: string;
        refresh_token: string;
        expires_in: number;
      } | null;
      user?: { id: string } | null;
    };
    error: { message: string } | null;
  }> => ({
    data: { session: null },
    error: { message: "Invalid Refresh Token" },
  }),
);

const resetPasswordForEmail = mock(
  async () =>
    ({
      data: {},
      error: null as { message: string } | null,
    }),
);

const signOut = mock(async () => ({ error: null }));
const updateUser = mock(async () => ({
  data: { user: { id: "user-1" } },
  error: null,
}));

mock.module("./supabase", () => ({
  createAnonClient: () => ({
    auth: {
      signInWithPassword,
      signUp,
      refreshSession,
      resetPasswordForEmail,
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
      signOut,
      updateUser,
    },
  }),
  createServiceClient: () => ({
    auth: { admin: {} },
  }),
}));

mock.module("./db", () => ({
  getDb: () => ({
    update: () => ({
      set: () => ({
        where: async () => [],
      }),
    }),
    select: () => ({
      from: () => ({
        where: () => ({
          limit: async () => [],
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
const { AUTH_BRIDGE_HEADER, AUTH_BRIDGE_VALUE } = await import("./auth-bridge");
const { AUTH_ERRORS } = await import("./auth-errors");
const { resetRateLimitBuckets } = await import("../plugins/rate-limit");

// Import app after mocks are registered.
const { app } = await import("../app");

describe("auth routes integration / security", () => {
  beforeEach(() => {
    resetLoginAttemptStore();
    resetRateLimitBuckets();
    signInWithPassword.mockClear();
    signUp.mockClear();
    refreshSession.mockClear();
    resetPasswordForEmail.mockClear();
    signOut.mockClear();
  });

  test("login returns generic invalid credentials without leaking provider text", async () => {
    const response = await app.handle(
      new Request("http://localhost/api/auth/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          email: "student@example.com",
          password: "wrong-password",
        }),
      }),
    );
    expect(response.status).toBe(401);
    const body = (await response.json()) as { error?: string };
    expect(body.error).toBe(AUTH_ERRORS.invalidCredentials);
    expect(body.error).not.toContain("Invalid login credentials");
  });

  test("login does not return tokens without bridge header", async () => {
    signInWithPassword.mockImplementationOnce(async () => ({
      data: {
        user: { id: "user-1", email: "student@example.com" },
        session: {
          access_token: "access-secret",
          refresh_token: "refresh-secret",
          expires_in: 3600,
        },
      },
      error: null,
    }));

    const response = await app.handle(
      new Request("http://localhost/api/auth/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          email: "student@example.com",
          password: "secret12",
        }),
      }),
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as Record<string, unknown>;
    expect(body.accessToken).toBeUndefined();
    expect(body.refreshToken).toBeUndefined();
    expect(body.redirectTo).toBe("/dashboard");
  });

  test("login returns tokens only for auth bridge", async () => {
    signInWithPassword.mockImplementationOnce(async () => ({
      data: {
        user: { id: "user-1", email: "student@example.com" },
        session: {
          access_token: "access-secret",
          refresh_token: "refresh-secret",
          expires_in: 3600,
        },
      },
      error: null,
    }));

    const response = await app.handle(
      new Request("http://localhost/api/auth/login", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          [AUTH_BRIDGE_HEADER]: AUTH_BRIDGE_VALUE,
        },
        body: JSON.stringify({
          email: "student@example.com",
          password: "secret12",
        }),
      }),
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as Record<string, unknown>;
    expect(body.accessToken).toBe("access-secret");
    expect(body.refreshToken).toBe("refresh-secret");
  });

  test("forgot-password always returns generic success", async () => {
    resetPasswordForEmail.mockImplementationOnce(async () => ({
      data: {},
      error: { message: "User not found" },
    }));

    const response = await app.handle(
      new Request("http://localhost/api/auth/forgot-password", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: "missing@example.com" }),
      }),
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as { success?: string };
    expect(body.success).toContain("If that email is registered");
  });

  test("refresh without cookie returns session expired", async () => {
    const response = await app.handle(
      new Request("http://localhost/api/auth/refresh", { method: "POST" }),
    );
    expect(response.status).toBe(401);
    const body = (await response.json()) as { error?: string };
    expect(body.error).toBe(AUTH_ERRORS.sessionExpired);
  });

  test("logout is idempotent without a session", async () => {
    const response = await app.handle(
      new Request("http://localhost/api/auth/logout", { method: "POST" }),
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as { ok?: boolean };
    expect(body.ok).toBe(true);
  });

  test("protected course route rejects unauthenticated requests", async () => {
    const response = await app.handle(
      new Request("http://localhost/api/courses", { method: "GET" }),
    );
    expect(response.status).toBe(401);
  });

  test("progressive delay returns 429 after repeated failed logins", async () => {
    for (let i = 0; i < 3; i++) {
      await app.handle(
        new Request("http://localhost/api/auth/login", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-forwarded-for": "9.9.9.9",
          },
          body: JSON.stringify({
            email: "bruteforce@example.com",
            password: "wrong-password",
          }),
        }),
      );
    }

    const response = await app.handle(
      new Request("http://localhost/api/auth/login", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-forwarded-for": "9.9.9.9",
        },
        body: JSON.stringify({
          email: "bruteforce@example.com",
          password: "wrong-password",
        }),
      }),
    );
    expect(response.status).toBe(429);
    const body = (await response.json()) as { error?: string };
    expect(body.error).toBe(AUTH_ERRORS.rateLimited);
  });

  test("tampered bearer token is rejected on protected routes", async () => {
    const response = await app.handle(
      new Request("http://localhost/api/courses", {
        method: "GET",
        headers: { authorization: "Bearer not-a-real-jwt" },
      }),
    );
    expect(response.status).toBe(401);
  });

  test("refresh with valid cookie rotates session for bridge clients", async () => {
    refreshSession.mockImplementationOnce(async () => ({
      data: {
        session: {
          access_token: "new-access",
          refresh_token: "new-refresh",
          expires_in: 3600,
        },
        user: { id: "user-1" },
      },
      error: null,
    }));

    const response = await app.handle(
      new Request("http://localhost/api/auth/refresh", {
        method: "POST",
        headers: {
          cookie: "dr_refresh_token=old-refresh",
          [AUTH_BRIDGE_HEADER]: AUTH_BRIDGE_VALUE,
        },
      }),
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as Record<string, unknown>;
    expect(body.ok).toBe(true);
    expect(body.accessToken).toBe("new-access");
    expect(body.refreshToken).toBe("new-refresh");
  });

  test("refresh after logout fails when refresh token is rejected", async () => {
    refreshSession.mockImplementationOnce(async () => ({
      data: { session: null },
      error: { message: "Invalid Refresh Token" },
    }));

    const response = await app.handle(
      new Request("http://localhost/api/auth/refresh", {
        method: "POST",
        headers: { cookie: "dr_refresh_token=revoked-token" },
      }),
    );
    expect(response.status).toBe(401);
    const body = (await response.json()) as { error?: string };
    expect(body.error).toBe(AUTH_ERRORS.sessionExpired);
  });

  test("register returns generic failure without provider message", async () => {
    const response = await app.handle(
      new Request("http://localhost/api/auth/register", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          email: "student@example.com",
          password: "secret12",
        }),
      }),
    );
    expect(response.status).toBe(400);
    const body = (await response.json()) as { error?: string };
    expect(body.error).toBe(AUTH_ERRORS.registrationFailed);
    expect(body.error).not.toContain("already registered");
  });

  test("logout-all requires authentication", async () => {
    const response = await app.handle(
      new Request("http://localhost/api/auth/logout-all", { method: "POST" }),
    );
    expect(response.status).toBe(401);
  });

  test("IP rate limit returns 429 on sensitive auth paths", async () => {
    resetRateLimitBuckets();
    let limited = false;
    for (let i = 0; i < 25; i++) {
      const response = await app.handle(
        new Request("http://localhost/api/auth/forgot-password", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-forwarded-for": "8.8.8.8",
          },
          body: JSON.stringify({ email: `user${i}@example.com` }),
        }),
      );
      if (response.status === 429) {
        limited = true;
        const body = (await response.json()) as { error?: string };
        expect(body.error).toContain("Too many requests");
        break;
      }
    }
    expect(limited).toBe(true);
  });
});
