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
const updateUser = mock(
  async (): Promise<
    | { data: { user: { id: string } }; error: null }
    | { data: { user: null }; error: { message: string } }
  > => ({
    data: { user: { id: "user-1" } },
    error: null,
  }),
);
const getUser = mock(async () => ({
  data: { user: { id: "user-1", email: "student@example.com" } },
  error: null,
}));

const exchangeCodeForSession = mock(
  async (): Promise<{
    data: {
      session: {
        access_token: string;
        refresh_token: string;
        expires_in: number;
      } | null;
      user?: { id: string; email: string } | null;
    };
    error: { message: string } | null;
  }> => ({
    data: { session: null },
    error: { message: "bad" },
  }),
);

mock.module("./supabase", () => ({
  createAnonClient: () => ({
    auth: {
      signInWithPassword,
      signUp,
      refreshSession,
      resetPasswordForEmail,
      exchangeCodeForSession,
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
process.env.AUTH_BRIDGE_SECRET ??= "test-auth-bridge-secret";
process.env.NODE_ENV = "test";
process.env.TRUST_PROXY = "true";

const { AUTH_BRIDGE_HEADER } = await import("./auth-bridge");
const AUTH_BRIDGE_VALUE = process.env.AUTH_BRIDGE_SECRET!;
const { AUTH_ERRORS } = await import("./auth-errors");
const { resetRateLimitBuckets } = await import("../plugins/rate-limit");
const { setVerifyAccessTokenOverride } = await import("./auth-tokens");
const {
  setLoadAuthorizationContextOverride,
  createAuthorizationContext,
} = await import("./authorization");

// Import app after mocks are registered.
const { app } = await import("../app");

describe("auth routes integration / security", () => {
  beforeEach(() => {
    resetLoginAttemptStore();
    resetRateLimitBuckets();
    setVerifyAccessTokenOverride(null);
    setLoadAuthorizationContextOverride(null);
    signInWithPassword.mockClear();
    signUp.mockClear();
    refreshSession.mockClear();
    resetPasswordForEmail.mockClear();
    signOut.mockClear();
    updateUser.mockClear();
    getUser.mockClear();
    exchangeCodeForSession.mockClear();
  });

  test("login returns generic invalid credentials without leaking provider text", async () => {
    const response = await app.handle(
      new Request("http://localhost/api/v1/auth/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          email: "student@example.com",
          password: "wrong-password",
        }),
      }),
    );
    expect(response.status).toBe(401);
    const body = (await response.json()) as { error?: { code?: string; message?: string } | string };
    const errMsg = typeof body.error === 'string' ? body.error : body.error?.message;
    expect(errMsg).toBe(AUTH_ERRORS.invalidCredentials);
    expect(errMsg).not.toContain("Invalid login credentials");
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
      new Request("http://localhost/api/v1/auth/login", {
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
    expect(body.redirectTo).toBe("/summary");
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
      new Request("http://localhost/api/v1/auth/login", {
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
      new Request("http://localhost/api/v1/auth/forgot-password", {
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
      new Request("http://localhost/api/v1/auth/refresh", { method: "POST" }),
    );
    expect(response.status).toBe(401);
    const body = (await response.json()) as { error?: { code?: string; message?: string } | string };
    const errMsg = typeof body.error === 'string' ? body.error : body.error?.message;
    expect(errMsg).toBe(AUTH_ERRORS.sessionExpired);
  });

  test("logout is idempotent without a session", async () => {
    const response = await app.handle(
      new Request("http://localhost/api/v1/auth/logout", { method: "POST" }),
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as { ok?: boolean };
    expect(body.ok).toBe(true);
  });

  test("protected course route rejects unauthenticated requests", async () => {
    const response = await app.handle(
      new Request("http://localhost/api/v1/courses", { method: "GET" }),
    );
    expect(response.status).toBe(401);
  });

  test("progressive delay returns 429 after repeated failed logins", async () => {
    for (let i = 0; i < 3; i++) {
      await app.handle(
        new Request("http://localhost/api/v1/auth/login", {
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
      new Request("http://localhost/api/v1/auth/login", {
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
    const body = (await response.json()) as { error?: { code?: string; message?: string } | string };
    const errMsg = typeof body.error === 'string' ? body.error : body.error?.message;
    expect(errMsg).toBe(AUTH_ERRORS.rateLimited);
  });

  test("tampered bearer token is rejected on protected routes", async () => {
    const response = await app.handle(
      new Request("http://localhost/api/v1/courses", {
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
      new Request("http://localhost/api/v1/auth/refresh", {
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
      new Request("http://localhost/api/v1/auth/refresh", {
        method: "POST",
        headers: { cookie: "dr_refresh_token=revoked-token" },
      }),
    );
    expect(response.status).toBe(401);
    const body = (await response.json()) as { error?: { code?: string; message?: string } | string };
    const errMsg = typeof body.error === 'string' ? body.error : body.error?.message;
    expect(errMsg).toBe(AUTH_ERRORS.sessionExpired);
  });

  test("register returns generic failure without provider message", async () => {
    const response = await app.handle(
      new Request("http://localhost/api/v1/auth/register", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          email: "student@example.com",
          password: "secret12",
        }),
      }),
    );
    expect(response.status).toBe(400);
    const body = (await response.json()) as { error?: { code?: string; message?: string } | string };
    const errMsg = typeof body.error === 'string' ? body.error : body.error?.message;
    expect(errMsg).toBe(AUTH_ERRORS.registrationFailed);
    expect(errMsg).not.toContain("already registered");
  });

  test("logout-all requires authentication", async () => {
    const response = await app.handle(
      new Request("http://localhost/api/v1/auth/logout-all", { method: "POST" }),
    );
    expect(response.status).toBe(401);
  });

  test("IP rate limit returns 429 on sensitive auth paths", async () => {
    resetRateLimitBuckets();
    let limited = false;
    for (let i = 0; i < 25; i++) {
      const response = await app.handle(
        new Request("http://localhost/api/v1/auth/forgot-password", {
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
        const body = (await response.json()) as { error?: { code?: string; message?: string } | string };
        const errMsg = typeof body.error === "string" ? body.error : body.error?.message;
        expect(errMsg).toContain("Too many requests");
        break;
      }
    }
    expect(limited).toBe(true);
  });

  test("reset-password without a valid session returns invalid reset", async () => {
    const response = await app.handle(
      new Request("http://localhost/api/v1/auth/reset-password", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          password: "new-secret12",
          confirmPassword: "new-secret12",
        }),
      }),
    );
    expect(response.status).toBe(401);
    const body = (await response.json()) as { error?: { code?: string; message?: string } | string };
    const errMsg = typeof body.error === "string" ? body.error : body.error?.message;
    expect(errMsg).toBe(AUTH_ERRORS.invalidReset);
  });

  test("reset-password happy path updates the password and clears the session", async () => {
    setVerifyAccessTokenOverride(async () => ({
      id: "user-1",
      email: "student@example.com",
      sessionId: "sess-1",
    }));

    const response = await app.handle(
      new Request("http://localhost/api/v1/auth/reset-password", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: "Bearer recovery-session-token",
        },
        body: JSON.stringify({
          password: "new-secret12",
          confirmPassword: "new-secret12",
        }),
      }),
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as { ok?: boolean; redirectTo?: string };
    expect(body.ok).toBe(true);
    expect(body.redirectTo).toBe("/login");
    expect(updateUser).toHaveBeenCalledTimes(1);
    expect(signOut).toHaveBeenCalledTimes(1);
  });

  test("reset-password rejects a weak password via validation", async () => {
    setVerifyAccessTokenOverride(async () => ({
      id: "user-1",
      email: "student@example.com",
      sessionId: "sess-1",
    }));

    const response = await app.handle(
      new Request("http://localhost/api/v1/auth/reset-password", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: "Bearer recovery-session-token",
        },
        body: JSON.stringify({
          password: "short",
          confirmPassword: "short",
        }),
      }),
    );
    expect(response.status).toBe(400);
    const body = (await response.json()) as { error?: { code?: string; message?: string } | string };
    const errMsg = typeof body.error === "string" ? body.error : body.error?.message;
    expect(errMsg).toBe(AUTH_ERRORS.invalidDetails);
    expect(updateUser).not.toHaveBeenCalled();
  });

  test("confirm with an invalid or expired code returns unable to complete", async () => {
    const response = await app.handle(
      new Request(
        "http://localhost/api/v1/auth/confirm?code=expired-or-invalid-code",
      ),
    );
    expect(response.status).toBe(400);
    const body = (await response.json()) as { error?: { code?: string; message?: string } | string };
    const errMsg = typeof body.error === "string" ? body.error : body.error?.message;
    expect(errMsg).toBe(AUTH_ERRORS.unableToComplete);
  });

  test("confirm happy path exchanges the code and redirects to the next page", async () => {
    exchangeCodeForSession.mockImplementationOnce(async () => ({
      data: {
        session: {
          access_token: "recovery-access",
          refresh_token: "recovery-refresh",
          expires_in: 3600,
        },
        user: { id: "user-1", email: "student@example.com" },
      },
      error: null,
    }));

    const response = await app.handle(
      new Request(
        "http://localhost/api/v1/auth/confirm?code=valid-code&next=/reset-password",
        { headers: { [AUTH_BRIDGE_HEADER]: AUTH_BRIDGE_VALUE } },
      ),
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      accessToken?: string;
      redirectTo?: string;
    };
    expect(body.accessToken).toBe("recovery-access");
    expect(body.redirectTo).toBe("/reset-password");
  });

  test("change-password rejects an incorrect current password", async () => {
    setVerifyAccessTokenOverride(async () => ({
      id: "user-1",
      email: "student@example.com",
      sessionId: "sess-1",
    }));
    setLoadAuthorizationContextOverride(async (subject) =>
      createAuthorizationContext({
        subject,
        roles: ["user"],
        capabilities: ["profile.password.update"],
      }),
    );
    signInWithPassword.mockImplementationOnce(async () => ({
      data: { session: null, user: null },
      error: { message: "Invalid login credentials" },
    }));

    const response = await app.handle(
      new Request("http://localhost/api/v1/auth/change-password", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: "Bearer signed-in-token",
        },
        body: JSON.stringify({
          currentPassword: "wrong-password",
          password: "new-secret12",
          confirmPassword: "new-secret12",
        }),
      }),
    );
    expect(response.status).toBe(400);
    const body = (await response.json()) as { error?: { code?: string; message?: string } | string };
    const errMsg = typeof body.error === "string" ? body.error : body.error?.message;
    expect(errMsg).toBe(AUTH_ERRORS.invalidCurrentPassword);
    expect(updateUser).not.toHaveBeenCalled();
  });

  test("change-password happy path updates the password", async () => {
    setVerifyAccessTokenOverride(async () => ({
      id: "user-1",
      email: "student@example.com",
      sessionId: "sess-1",
    }));
    setLoadAuthorizationContextOverride(async (subject) =>
      createAuthorizationContext({
        subject,
        roles: ["user"],
        capabilities: ["profile.password.update"],
      }),
    );
    signInWithPassword.mockImplementationOnce(async () => ({
      data: {
        session: {
          access_token: "verify-access",
          refresh_token: "verify-refresh",
          expires_in: 3600,
        },
        user: { id: "user-1", email: "student@example.com" },
      },
      error: null,
    }));

    const response = await app.handle(
      new Request("http://localhost/api/v1/auth/change-password", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: "Bearer signed-in-token",
        },
        body: JSON.stringify({
          currentPassword: "old-secret12",
          password: "new-secret12",
          confirmPassword: "new-secret12",
        }),
      }),
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as { ok?: boolean };
    expect(body.ok).toBe(true);
    expect(signInWithPassword).toHaveBeenCalledWith({
      email: "student@example.com",
      password: "old-secret12",
    });
    expect(updateUser).toHaveBeenCalledTimes(1);
    expect(updateUser).toHaveBeenCalledWith({ password: "new-secret12" });
  });

  test("change-password rejects a weak new password via validation", async () => {
    setVerifyAccessTokenOverride(async () => ({
      id: "user-1",
      email: "student@example.com",
      sessionId: "sess-1",
    }));
    setLoadAuthorizationContextOverride(async (subject) =>
      createAuthorizationContext({
        subject,
        roles: ["user"],
        capabilities: ["profile.password.update"],
      }),
    );

    const response = await app.handle(
      new Request("http://localhost/api/v1/auth/change-password", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: "Bearer signed-in-token",
        },
        body: JSON.stringify({
          currentPassword: "old-secret12",
          password: "short",
          confirmPassword: "short",
        }),
      }),
    );
    expect(response.status).toBe(400);
    const body = (await response.json()) as { error?: { code?: string; message?: string } | string };
    const errMsg = typeof body.error === "string" ? body.error : body.error?.message;
    expect(errMsg).toBe(AUTH_ERRORS.invalidDetails);
    expect(updateUser).not.toHaveBeenCalled();
  });

  test("change-password requires the profile.password.update capability", async () => {
    setVerifyAccessTokenOverride(async () => ({
      id: "user-1",
      email: "student@example.com",
      sessionId: "sess-1",
    }));
    setLoadAuthorizationContextOverride(async (subject) =>
      createAuthorizationContext({
        subject,
        roles: ["user"],
        capabilities: ["profile.view"],
      }),
    );

    const response = await app.handle(
      new Request("http://localhost/api/v1/auth/change-password", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: "Bearer signed-in-token",
        },
        body: JSON.stringify({
          currentPassword: "old-secret12",
          password: "new-secret12",
          confirmPassword: "new-secret12",
        }),
      }),
    );
    expect(response.status).toBe(403);
  });

  test("change-email happy path requests a change and returns the pending email", async () => {
    setVerifyAccessTokenOverride(async () => ({
      id: "user-1",
      email: "student@example.com",
      sessionId: "sess-1",
    }));
    setLoadAuthorizationContextOverride(async (subject) =>
      createAuthorizationContext({
        subject,
        roles: ["user"],
        capabilities: ["profile.email.update"],
      }),
    );
    signInWithPassword.mockImplementationOnce(async () => ({
      data: {
        session: {
          access_token: "verify-access",
          refresh_token: "verify-refresh",
          expires_in: 3600,
        },
        user: { id: "user-1", email: "student@example.com" },
      },
      error: null,
    }));
    updateUser.mockImplementationOnce(async () => ({
      data: {
        user: {
          id: "user-1",
          email: "student@example.com",
          new_email: "new@example.com",
        },
      },
      error: null,
    }));

    const response = await app.handle(
      new Request("http://localhost/api/v1/auth/change-email", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: "Bearer signed-in-token",
        },
        body: JSON.stringify({
          email: "new@example.com",
          currentPassword: "old-secret12",
        }),
      }),
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      ok?: boolean;
      pendingEmail?: string;
    };
    expect(body.ok).toBe(true);
    expect(body.pendingEmail).toBe("new@example.com");
    expect(updateUser).toHaveBeenCalledTimes(1);
    expect(updateUser).toHaveBeenCalledWith({ email: "new@example.com" });
  });

  test("change-email rejects an unavailable address with a friendly error", async () => {
    setVerifyAccessTokenOverride(async () => ({
      id: "user-1",
      email: "student@example.com",
      sessionId: "sess-1",
    }));
    setLoadAuthorizationContextOverride(async (subject) =>
      createAuthorizationContext({
        subject,
        roles: ["user"],
        capabilities: ["profile.email.update"],
      }),
    );
    signInWithPassword.mockImplementationOnce(async () => ({
      data: {
        session: {
          access_token: "verify-access",
          refresh_token: "verify-refresh",
          expires_in: 3600,
        },
        user: { id: "user-1", email: "student@example.com" },
      },
      error: null,
    }));
    updateUser.mockImplementationOnce(async () => ({
      data: { user: null },
      error: { message: "Email already in use" },
    }));

    const response = await app.handle(
      new Request("http://localhost/api/v1/auth/change-email", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: "Bearer signed-in-token",
        },
        body: JSON.stringify({
          email: "taken@example.com",
          currentPassword: "old-secret12",
        }),
      }),
    );
    expect(response.status).toBe(400);
    const body = (await response.json()) as { error?: { code?: string; message?: string } | string };
    const errMsg = typeof body.error === "string" ? body.error : body.error?.message;
    expect(errMsg).toBe(AUTH_ERRORS.emailUnavailable);
    expect(errMsg).not.toContain("already in use");
  });

  test("session surfaces a pending email change from the Auth user", async () => {
    setVerifyAccessTokenOverride(async () => ({
      id: "user-1",
      email: "student@example.com",
      sessionId: "sess-1",
    }));
    setLoadAuthorizationContextOverride(async (subject) =>
      createAuthorizationContext({
        subject,
        roles: ["user"],
        capabilities: ["profile.view"],
      }),
    );
    getUser.mockImplementationOnce(async () => ({
      data: {
        user: {
          id: "user-1",
          email: "student@example.com",
          new_email: "new@example.com",
        },
      },
      error: null,
    }));

    const response = await app.handle(
      new Request("http://localhost/api/v1/auth/session", {
        headers: { authorization: "Bearer signed-in-token" },
      }),
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      user?: { pendingEmail?: string | null };
    };
    expect(body.user?.pendingEmail).toBe("new@example.com");
  });
});
