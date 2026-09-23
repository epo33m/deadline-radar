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
const { env } = await import("../env");
const { resetRateLimitBuckets } = await import("../plugins/rate-limit");
const { setVerifyAccessTokenOverride, setVerifyAccessTokenClaimsOverride } =
  await import("./auth-tokens");
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
    setVerifyAccessTokenClaimsOverride(null);
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

  test("forgot-password ignores an attacker Origin header", async () => {
    {
      const response = await app.handle(
        new Request("http://localhost/api/v1/auth/forgot-password", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            origin: "https://evil.example",
          },
          body: JSON.stringify({ email: "student@example.com" }),
        }),
      );
      expect(response.status).toBe(200);
      const calls = resetPasswordForEmail.mock.calls as unknown as Array<
        [string, { redirectTo?: string }?]
      >;
      expect(calls.length).toBeGreaterThan(0);
      const redirectTo = calls[calls.length - 1][1]?.redirectTo;
      expect(redirectTo).toBe(
        `${env.webOrigin.replace(/\/$/, "")}/auth/confirm?next=/reset-password`,
      );
      expect(redirectTo).not.toContain("evil");
    }
  });

  test("forgot-password ignores an attacker X-Forwarded-Host header", async () => {
    {
      const response = await app.handle(
        new Request("http://localhost/api/v1/auth/forgot-password", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-forwarded-host": "evil.example",
          },
          body: JSON.stringify({ email: "student@example.com" }),
        }),
      );
      expect(response.status).toBe(200);
      const calls = resetPasswordForEmail.mock.calls as unknown as Array<
        [string, { redirectTo?: string }?]
      >;
      const redirectTo = calls[calls.length - 1][1]?.redirectTo;
      expect(redirectTo).toBe(
        `${env.webOrigin.replace(/\/$/, "")}/auth/confirm?next=/reset-password`,
      );
      expect(redirectTo).not.toContain("evil");
    }
  });

  test("forgot-password ignores both attacker headers at once", async () => {
    {
      const response = await app.handle(
        new Request("http://localhost/api/v1/auth/forgot-password", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            origin: "https://evil.example",
            "x-forwarded-host": "evil.example",
          },
          body: JSON.stringify({ email: "student@example.com" }),
        }),
      );
      expect(response.status).toBe(200);
      const calls = resetPasswordForEmail.mock.calls as unknown as Array<
        [string, { redirectTo?: string }?]
      >;
      const redirectTo = calls[calls.length - 1][1]?.redirectTo;
      expect(redirectTo).toBe(
        `${env.webOrigin.replace(/\/$/, "")}/auth/confirm?next=/reset-password`,
      );
    }
  });

  test("forgot-password without Origin uses the trusted webOrigin", async () => {
    {
      const response = await app.handle(
        new Request("http://localhost/api/v1/auth/forgot-password", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ email: "student@example.com" }),
        }),
      );
      expect(response.status).toBe(200);
      const body = (await response.json()) as { success?: string };
      expect(body.success).toContain("If that email is registered");
      const calls = resetPasswordForEmail.mock.calls as unknown as Array<
        [string, { redirectTo?: string }?]
      >;
      expect(calls[calls.length - 1][1]?.redirectTo).toBe(
        `${env.webOrigin.replace(/\/$/, "")}/auth/confirm?next=/reset-password`,
      );
    }
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

  test("logout emits scoped deletion cookies for both session cookies", async () => {
    const response = await app.handle(
      new Request("http://localhost/api/v1/auth/logout", { method: "POST" }),
    );
    expect(response.status).toBe(200);
    const setCookies =
      typeof response.headers.getSetCookie === "function"
        ? response.headers.getSetCookie()
        : [];
    const byName = new Map(
      setCookies.map((header) => [
        header.slice(0, header.indexOf("=")),
        header.toLowerCase(),
      ]),
    );
    for (const name of ["dr_access_token", "dr_refresh_token"]) {
      const header = byName.get(name);
      expect(header, `deletion Set-Cookie for ${name}`).toBeDefined();
      // Deletion scope matches creation: HttpOnly, Path=/, SameSite=Lax,
      // Max-Age=0 (+Secure in production, covered by unit matrix).
      expect(header).toContain("httponly");
      expect(header).toContain("path=/");
      expect(header).toContain("samesite=lax");
      expect(header).toMatch(/max-age=0/);
      // No token values leak into the deletion emission.
      expect(header).not.toContain("bearer");
    }
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
    setVerifyAccessTokenClaimsOverride(async () => ({
      sub: "user-1",
      amr: [{ method: "recovery", timestamp: 1700000000 }],
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
    setVerifyAccessTokenClaimsOverride(async () => ({
      sub: "user-1",
      amr: [{ method: "recovery", timestamp: 1700000000 }],
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

  test("reset-password rejects a normal login session token", async () => {
    setVerifyAccessTokenOverride(async () => ({
      id: "user-1",
      email: "student@example.com",
      sessionId: "sess-1",
    }));
    setVerifyAccessTokenClaimsOverride(async () => ({
      sub: "user-1",
      amr: [{ method: "password", timestamp: 1700000000 }],
    }));

    const response = await app.handle(
      new Request("http://localhost/api/v1/auth/reset-password", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: "Bearer normal-login-session-token",
        },
        body: JSON.stringify({
          password: "new-secret12",
          confirmPassword: "new-secret12",
        }),
      }),
    );
    expect(response.status).toBe(401);
    const body = (await response.json()) as {
      error?: { code?: string; message?: string } | string;
    };
    const err = body.error;
    expect(typeof err === "string" ? err : err?.code).toBe("UNAUTHORIZED");
    expect(typeof err === "string" ? err : err?.message).toBe(
      AUTH_ERRORS.invalidReset,
    );
    expect(updateUser).not.toHaveBeenCalled();
    expect(signOut).not.toHaveBeenCalled();
  });

  test("reset-password accepts a recovery session with string amr format", async () => {
    setVerifyAccessTokenOverride(async () => ({
      id: "user-1",
      email: "student@example.com",
      sessionId: "sess-1",
    }));
    setVerifyAccessTokenClaimsOverride(async () => ({
      sub: "user-1",
      amr: ["recovery"],
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
  });

  test("reset-password rejects an unverifiable token", async () => {
    setVerifyAccessTokenClaimsOverride(async () => null);

    const response = await app.handle(
      new Request("http://localhost/api/v1/auth/reset-password", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: "Bearer forged-or-expired-token",
        },
        body: JSON.stringify({
          password: "new-secret12",
          confirmPassword: "new-secret12",
        }),
      }),
    );
    expect(response.status).toBe(401);
    const body = (await response.json()) as {
      error?: { code?: string; message?: string } | string;
    };
    const err = body.error;
    expect(typeof err === "string" ? err : err?.code).toBe("UNAUTHORIZED");
    expect(typeof err === "string" ? err : err?.message).toBe(
      AUTH_ERRORS.invalidReset,
    );
    expect(updateUser).not.toHaveBeenCalled();
  });

  test("reset-password ignores a spoofed userId in the request body", async () => {
    setVerifyAccessTokenOverride(async () => ({
      id: "user-1",
      email: "student@example.com",
      sessionId: "sess-1",
    }));
    setVerifyAccessTokenClaimsOverride(async () => ({
      sub: "user-1",
      amr: [{ method: "recovery", timestamp: 1700000000 }],
    }));

    const response = await app.handle(
      new Request("http://localhost/api/v1/auth/reset-password", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: "Bearer recovery-session-token-user-1",
        },
        body: JSON.stringify({
          password: "new-secret12",
          confirmPassword: "new-secret12",
          userId: "user-B",
        }),
      }),
    );
    // Strict schema rejects unknown keys: identity can only come from the
    // server-verified token, never from the client body.
    expect(response.status).toBe(400);
    const body = (await response.json()) as {
      error?: { code?: string; message?: string } | string;
    };
    const err = body.error;
    expect(typeof err === "string" ? err : err?.code).toBe("VALIDATION_ERROR");
    expect(updateUser).not.toHaveBeenCalled();
  });

  test("reset-password rejects a genuinely expired JWT via real signature verification", async () => {
    const { SignJWT } = await import("jose");
    const { resolveSupabaseUrl } = await import("../env");
    process.env.SUPABASE_URL ??= "http://127.0.0.1:54321";
    process.env.SUPABASE_JWT_SECRET ??= "test-only-jwt-secret-32-chars-min!!";
    const secret = process.env.SUPABASE_JWT_SECRET!;
    const issuer = `${resolveSupabaseUrl().replace(/\/$/, "")}/auth/v1`;
    const now = Math.floor(Date.now() / 1000);
    const expiredRecoveryToken = await new SignJWT({
      sub: "user-1",
      amr: [{ method: "recovery", timestamp: now - 7200 }],
    })
      .setProtectedHeader({ alg: "HS256" })
      .setIssuer(issuer)
      .setIssuedAt(now - 7200)
      .setExpirationTime(now - 3600)
      .sign(new TextEncoder().encode(secret));

    // No overrides: exercises the real JWKS→HS256 verification path.
    const response = await app.handle(
      new Request("http://localhost/api/v1/auth/reset-password", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${expiredRecoveryToken}`,
        },
        body: JSON.stringify({
          password: "new-secret12",
          confirmPassword: "new-secret12",
        }),
      }),
    );
    expect(response.status).toBe(401);
    const body = (await response.json()) as {
      error?: { code?: string; message?: string } | string;
    };
    const err = body.error;
    expect(typeof err === "string" ? err : err?.code).toBe("UNAUTHORIZED");
    expect(updateUser).not.toHaveBeenCalled();
  });

  test("reset-password accepts a genuinely signed recovery JWT via real verification", async () => {
    const { SignJWT } = await import("jose");
    const { resolveSupabaseUrl } = await import("../env");
    process.env.SUPABASE_URL ??= "http://127.0.0.1:54321";
    process.env.SUPABASE_JWT_SECRET ??= "test-only-jwt-secret-32-chars-min!!";
    const secret = process.env.SUPABASE_JWT_SECRET!;
    const issuer = `${resolveSupabaseUrl().replace(/\/$/, "")}/auth/v1`;
    const now = Math.floor(Date.now() / 1000);
    const validRecoveryToken = await new SignJWT({
      sub: "user-1",
      email: "student@example.com",
      amr: [{ method: "recovery", timestamp: now }],
    })
      .setProtectedHeader({ alg: "HS256" })
      .setIssuer(issuer)
      .setAudience("authenticated")
      .setIssuedAt(now)
      .setExpirationTime(now + 3600)
      .sign(new TextEncoder().encode(secret));

    // No overrides: real signature + expiry + recovery-amr verification.
    const response = await app.handle(
      new Request("http://localhost/api/v1/auth/reset-password", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${validRecoveryToken}`,
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

  test("confirm bridge preserves a legitimate summary next", async () => {
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
        "http://localhost/api/v1/auth/confirm?code=valid-code&next=/summary",
        { headers: { [AUTH_BRIDGE_HEADER]: AUTH_BRIDGE_VALUE } },
      ),
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as { redirectTo?: string };
    expect(body.redirectTo).toBe("/summary");
  });

  test.each([
    "//evil.com",
    "///evil.com",
    "/\\evil.com",
    "https://evil.com",
    "http://evil.com",
    "javascript:alert(1)",
    "data:text/html,<h1>x</h1>",
    "/settings",
  ])("confirm bridge falls back to /summary for next=%s", async (next) => {
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
        `http://localhost/api/v1/auth/confirm?code=valid-code&next=${encodeURIComponent(next)}`,
        { headers: { [AUTH_BRIDGE_HEADER]: AUTH_BRIDGE_VALUE } },
      ),
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as { redirectTo?: string };
    expect(body.redirectTo).toBe("/summary");
  });

  test("confirm non-bridge never leaks an attacker next into Location", async () => {
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
        `http://localhost/api/v1/auth/confirm?code=valid-code&next=${encodeURIComponent("//evil.com")}`,
      ),
    );
    // NOTE: `set.redirect` is not honored by the installed Elysia version
    // (pre-existing, out of scope) — assert the security property directly:
    // no external/protocol-relative Location may ever be emitted.
    const location = response.headers.get("location");
    expect(location === null || location.startsWith(env.webOrigin)).toBe(true);
    expect(location ?? "").not.toContain("evil");
  });

  test("confirm non-bridge still creates the recovery session", async () => {
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
      ),
    );
    expect(response.status).toBe(200);
    const setCookie =
      typeof response.headers.getSetCookie === "function"
        ? response.headers.getSetCookie().join(";")
        : (response.headers.get("set-cookie") ?? "");
    expect(setCookie).toContain("dr_access_token");
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
