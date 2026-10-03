import { Elysia, t } from "elysia";
import { eq } from "drizzle-orm";
import {
  forgotPasswordSchema,
  loginSchema,
  registerSchema,
  resetPasswordSchema,
  changePasswordSchema,
  changeEmailSchema,
  timezoneUpdateSchema,
  timeFormatUpdateSchema,
  resolveConfirmNextPath,
} from "@deadline-radar/validation";
import { profiles } from "@deadline-radar/db";

import { authPlugin } from "../plugins/auth";
import { getDb } from "../lib/db";
import {
  createAnonClient,
  createUserClient,
} from "../lib/supabase";
import {
  ACCESS_COOKIE,
  REFRESH_COOKIE,
  REFRESH_COOKIE_MAX_AGE_SECONDS,
  clearedCookieOptions,
  cookieOptions,
  isRecoverySession,
  verifyAccessToken,
  verifyAccessTokenClaims,
} from "../lib/auth-tokens";
import {
  isAuthBridgeRequest,
  withBridgeTokens,
} from "../lib/auth-bridge";
import { recordAuthEvent } from "../lib/auth-audit";
import {
  accountAttemptKey,
  clearAccountFailures,
  clearLoginFailures,
  clientIpFromRequest,
  getAccountDelayMs,
  getLoginDelayMs,
  loginAttemptKey,
  recordAccountFailure,
  recordLoginFailure,
} from "../lib/auth-abuse";
import { peerAddressOf } from "../lib/proxy-trust";
import { AUTH_ERRORS, logAuthProviderError } from "../lib/auth-errors";
import { ApiError, validationFromZod } from "../lib/api/errors";
import {
  apiDoc,
  envelope,
  jsonBodyDetail,
  openApiBodies,
  R,
  readJsonBody,
  secured,
} from "../lib/api";
import { env } from "../env";

function isValidTimeZone(timeZone: string): boolean {
  if (!timeZone) return false;
  try {
    Intl.DateTimeFormat(undefined, { timeZone });
    return true;
  } catch {
    return false;
  }
}

type CookieBag = Record<
  string,
  { set: (v: unknown) => void; remove: () => void; value?: unknown }
>;

function setSessionCookies(
  cookie: CookieBag,
  accessToken: string,
  refreshToken: string,
  expiresIn: number,
) {
  cookie[ACCESS_COOKIE].set({
    value: accessToken,
    ...cookieOptions(expiresIn),
  });
  cookie[REFRESH_COOKIE].set({
    value: refreshToken,
    ...cookieOptions(REFRESH_COOKIE_MAX_AGE_SECONDS),
  });
}

function clearSessionCookies(cookie: CookieBag) {
  for (const name of [ACCESS_COOKIE, REFRESH_COOKIE]) {
    cookie[name].set({ value: "", ...clearedCookieOptions() });
  }
}

function readRefreshCookie(cookie: CookieBag): string | null {
  const value = cookie[REFRESH_COOKIE]?.value;
  return typeof value === "string" && value.length > 0 ? value : null;
}

function pendingConfirmationBody() {
  return {
    message:
      "Check your email to confirm your account before signing in. (Or disable email confirmation in Supabase Auth settings for local MVP.)",
  };
}

function forgotPasswordSuccessBody() {
  return {
    success:
      "If that email is registered, you will receive a reset link shortly.",
  };
}

export const authRoutes = new Elysia({ prefix: "/api/v1/auth" })
  .use(authPlugin)
  .post(
    "/register",
    async ({ cookie, set, request }) => {
      const bridge = isAuthBridgeRequest(request);
      const body = await readJsonBody(request);
      const parsed = registerSchema.safeParse(body);
      if (!parsed.success) {
        throw validationFromZod(
          AUTH_ERRORS.invalidDetails,
          parsed.error.flatten().fieldErrors,
        );
      }

      const timezone =
        typeof parsed.data.timezone === "string" &&
        isValidTimeZone(parsed.data.timezone)
          ? parsed.data.timezone
          : "UTC";

      const supabase = createAnonClient();
      const { data, error } = await supabase.auth.signUp({
        email: parsed.data.email,
        password: parsed.data.password,
      });

      if (error) {
        logAuthProviderError("register", error);
        await recordAuthEvent({
          event: "register.failure",
          result: "failure",
          method: "password",
          request,
        });
        const msg = (error.message || "").toLowerCase();
        const code = (error as { code?: string }).code;
        if (
          code === "user_already_exists" ||
          code === "email_exists" ||
          msg.includes("already registered") ||
          msg.includes("already in use") ||
          msg.includes("already exists") ||
          msg.includes("user already")
        ) {
          set.status = 202;
          return pendingConfirmationBody();
        }
        throw ApiError.validation(AUTH_ERRORS.registrationFailed);
      }

      if (
        data.user &&
        Array.isArray(data.user.identities) &&
        data.user.identities.length === 0
      ) {
        await recordAuthEvent({
          event: "register.failure",
          result: "failure",
          method: "password",
          request,
        });
        set.status = 202;
        return pendingConfirmationBody();
      }

      if (data.session && data.user) {
        await getDb()
          .update(profiles)
          .set({ timezone })
          .where(eq(profiles.id, data.user.id));

        setSessionCookies(
          cookie as never,
          data.session.access_token,
          data.session.refresh_token,
          data.session.expires_in,
        );

        const authUser = await verifyAccessToken(data.session.access_token);
        await recordAuthEvent({
          event: "register.success",
          result: "success",
          userId: data.user.id,
          sessionId: authUser?.sessionId,
          method: "password",
          request,
        });

        return withBridgeTokens(
          {
            user: { id: data.user.id, email: data.user.email },
            redirectTo: "/settings",
          },
          {
            accessToken: data.session.access_token,
            refreshToken: data.session.refresh_token,
            expiresIn: data.session.expires_in,
          },
          bridge,
        );
      }

      await recordAuthEvent({
        event: "register.pending_confirmation",
        result: "success",
        userId: data.user?.id,
        method: "password",
        request,
      });

      set.status = 202;
      return pendingConfirmationBody();
    },
    {
      detail: {
        tags: ["Auth"],
        summary: "Register",
        requestBody: jsonBodyDetail(openApiBodies.register),
        ...apiDoc({
          ok: envelope(
            {
              user: {
                type: "object",
                required: ["id", "email"],
                properties: {
                  id: { type: "string", format: "uuid" },
                  email: { type: "string", nullable: true },
                },
              },
              redirectTo: { type: "string" },
            },
            ["user", "redirectTo"],
          ),
          description:
            "200 with a session when email confirmation is off; 202 " +
            "when a confirmation email was sent.",
          errors: [400, 429],
          extraResponses: {
            202: {
              description: "Confirmation email sent; no session yet.",
              content: {
                "application/json": {
                  schema: envelope({ message: { type: "string" } }, [
                    "message",
                  ]),
                },
              },
            },
          },
        }),
      },
    },
  )
  .post(
    "/login",
    async ({ cookie, set, request, server }) => {
      const bridge = isAuthBridgeRequest(request);
      const body = await readJsonBody(request);
      const parsed = loginSchema.safeParse(body);
      if (!parsed.success) {
        throw validationFromZod(
          AUTH_ERRORS.invalidDetails,
          parsed.error.flatten().fieldErrors,
        );
      }

      const ip = clientIpFromRequest(request, peerAddressOf(server, request));
      const attemptKey = loginAttemptKey(parsed.data.email, ip);
      const delayMs = await getLoginDelayMs(attemptKey);
      if (delayMs > 0) {
        await recordAuthEvent({
          event: "login.failure_rate_limited",
          result: "denied",
          method: "password",
          request,
          metadata: { delayMs, scope: "ip" },
        });
        set.headers["Retry-After"] = String(Math.ceil(delayMs / 1000));
        throw ApiError.rateLimited(AUTH_ERRORS.rateLimited);
      }

      // Account-level throttle (Finding #9): survives client-IP rotation.
      // Keyed by normalized email for any address, so it reveals nothing
      // about account existence; same generic 429 as the IP scope.
      const accountKey = accountAttemptKey(parsed.data.email);
      const accountDelayMs = await getAccountDelayMs(accountKey);
      if (accountDelayMs > 0) {
        await recordAuthEvent({
          event: "login.failure_rate_limited",
          result: "denied",
          method: "password",
          request,
          metadata: { delayMs: accountDelayMs, scope: "account" },
        });
        set.headers["Retry-After"] = String(
          Math.ceil(accountDelayMs / 1000),
        );
        throw ApiError.rateLimited(AUTH_ERRORS.rateLimited);
      }

      const supabase = createAnonClient();
      const { data, error } = await supabase.auth.signInWithPassword({
        email: parsed.data.email,
        password: parsed.data.password,
      });

      if (error || !data.session || !data.user) {
        logAuthProviderError("login", error);
        const nextDelay = await recordLoginFailure(attemptKey);
        await recordAccountFailure(accountKey);
        await recordAuthEvent({
          event: "login.failure",
          result: "failure",
          method: "password",
          request,
          metadata: nextDelay > 0 ? { delayMs: nextDelay } : undefined,
        });
        throw ApiError.unauthorized(AUTH_ERRORS.invalidCredentials);
      }

      await clearLoginFailures(attemptKey);
      await clearAccountFailures(accountKey);
      setSessionCookies(
        cookie as never,
        data.session.access_token,
        data.session.refresh_token,
        data.session.expires_in,
      );

      const authUser = await verifyAccessToken(data.session.access_token);
      await recordAuthEvent({
        event: "login.success",
        result: "success",
        userId: data.user.id,
        sessionId: authUser?.sessionId,
        method: "password",
        request,
      });

      return withBridgeTokens(
        {
          user: { id: data.user.id, email: data.user.email },
          redirectTo: "/summary",
        },
        {
          accessToken: data.session.access_token,
          refreshToken: data.session.refresh_token,
          expiresIn: data.session.expires_in,
        },
        bridge,
      );
    },
    {
      detail: {
        tags: ["Auth"],
        summary: "Login",
        requestBody: jsonBodyDetail(openApiBodies.login),
        ...apiDoc({
          ok: envelope(
            {
              user: {
                type: "object",
                required: ["id", "email"],
                properties: {
                  id: { type: "string", format: "uuid" },
                  email: { type: "string", nullable: true },
                },
              },
              redirectTo: { type: "string" },
            },
            ["user", "redirectTo"],
          ),
          description:
            "Throttled responses carry a `Retry-After` (seconds) header.",
          errors: [400, 401, 429],
        }),
      },
    },
  )
  .post(
    "/refresh",
    async ({ cookie, set, request }) => {
      const bridge = isAuthBridgeRequest(request);
      const refreshToken = readRefreshCookie(cookie as never);
      if (!refreshToken) {
        clearSessionCookies(cookie as never);
        throw ApiError.unauthorized(AUTH_ERRORS.sessionExpired);
      }

      const supabase = createAnonClient();
      const { data, error } = await supabase.auth.refreshSession({
        refresh_token: refreshToken,
      });

      if (error || !data.session) {
        logAuthProviderError("refresh", error);
        clearSessionCookies(cookie as never);
        await recordAuthEvent({
          event: "session.refresh_failure",
          result: "failure",
          method: "refresh_token",
          request,
        });
        throw ApiError.unauthorized(AUTH_ERRORS.sessionExpired);
      }

      setSessionCookies(
        cookie as never,
        data.session.access_token,
        data.session.refresh_token,
        data.session.expires_in,
      );

      const authUser = await verifyAccessToken(data.session.access_token);
      await recordAuthEvent({
        event: "session.refresh",
        result: "success",
        userId: authUser?.id ?? data.user?.id,
        sessionId: authUser?.sessionId,
        method: "refresh_token",
        request,
      });

      return withBridgeTokens(
        { ok: true, authenticated: true },
        {
          accessToken: data.session.access_token,
          refreshToken: data.session.refresh_token,
          expiresIn: data.session.expires_in,
        },
        bridge,
      );
    },
    {
      detail: {
        tags: ["Auth"],
        summary: "Refresh session",
        ...apiDoc({
          ok: envelope(
            {
              ok: { type: "boolean" },
              authenticated: { type: "boolean" },
            },
            ["ok", "authenticated"],
          ),
          description: "Reads the `dr_refresh_token` cookie; rotates both.",
          errors: [401, 429],
        }),
      },
    },
  )
  .post(
    "/logout",
    async ({ cookie, accessToken, user, request }) => {
      if (accessToken) {
        try {
          const userClient = createUserClient(accessToken);
          await userClient.auth.signOut({ scope: "local" });
        } catch (error) {
          console.warn(
            "[auth] logout signOut:",
            error instanceof Error ? error.message : "unknown",
          );
        }
      }
      clearSessionCookies(cookie as never);
      await recordAuthEvent({
        event: "logout",
        result: "success",
        userId: user?.id,
        sessionId: user?.sessionId,
        method: "session",
        request,
      });
      return { ok: true, redirectTo: "/login" };
    },
    {
      detail: {
        tags: ["Auth"],
        summary: "Logout current session",
        ...apiDoc({
          ok: envelope({ ok: { type: "boolean" }, redirectTo: { type: "string" } }, [
            "ok",
            "redirectTo",
          ]),
          description: "Idempotent without a session; never requires auth.",
          errors: [429],
        }),
      },
    },
  )
  .post(
    "/logout-all",
    async ({ cookie, accessToken, requireUser, request, set }) => {
      const user = requireUser();
      if (!accessToken) {
        throw ApiError.unauthorized(AUTH_ERRORS.unauthorized);
      }
      try {
        const userClient = createUserClient(accessToken);
        await userClient.auth.signOut({ scope: "global" });
      } catch (error) {
        console.warn(
          "[auth] logout-all signOut:",
          error instanceof Error ? error.message : "unknown",
        );
      }
      clearSessionCookies(cookie as never);
      await recordAuthEvent({
        event: "logout_all",
        result: "success",
        userId: user.id,
        sessionId: user.sessionId,
        method: "session",
        request,
      });
      return { ok: true, redirectTo: "/login" };
    },
    {
      detail: {
        tags: ["Auth"],
        summary: "Logout all sessions",
        ...secured(),
        ...apiDoc({
          ok: envelope({ ok: { type: "boolean" }, redirectTo: { type: "string" } }, [
            "ok",
            "redirectTo",
          ]),
          errors: [401, 429],
        }),
      },
    },
  )
  .post(
    "/forgot-password",
    async ({ request }) => {
      const body = await readJsonBody(request);
      const parsed = forgotPasswordSchema.safeParse(body);
      if (!parsed.success) {
        throw validationFromZod(
          AUTH_ERRORS.invalidDetails,
          parsed.error.flatten().fieldErrors,
        );
      }

      // Trusted server-side origin only. Never derive the reset-link
      // destination from client-controlled headers (Origin, X-Forwarded-Host):
      // an attacker-supplied base would poison the password-reset email link.
      const base = env.webOrigin.replace(/\/$/, "");
      const redirectTo = `${base}/auth/confirm?next=/reset-password`;

      const supabase = createAnonClient();
      const { error } = await supabase.auth.resetPasswordForEmail(
        parsed.data.email,
        { redirectTo },
      );

      if (error) {
        logAuthProviderError("forgot-password", error);
      }

      await recordAuthEvent({
        event: "password_reset.request",
        result: "success",
        method: "email",
        request,
      });

      // Always generic — do not reveal whether the account exists.
      return forgotPasswordSuccessBody();
    },
    {
      detail: {
        tags: ["Auth"],
        summary: "Request password reset",
        requestBody: jsonBodyDetail(openApiBodies.forgotPassword),
        ...apiDoc({
          ok: envelope({ success: { type: "string" } }, ["success"]),
          description:
            "Always generic — reveals nothing about account existence.",
          errors: [400, 429],
        }),
      },
    },
  )
  .post(
    "/reset-password",
    async ({ cookie, accessToken, request }) => {
      const body = await readJsonBody(request);
      const parsed = resetPasswordSchema.safeParse(body);
      if (!parsed.success) {
        throw validationFromZod(
          AUTH_ERRORS.invalidDetails,
          parsed.error.flatten().fieldErrors,
        );
      }

      if (!accessToken) {
        throw ApiError.unauthorized(AUTH_ERRORS.invalidReset);
      }

      // Recovery-scoped authorization: only a session established through the
      // password-recovery flow (Supabase `amr: [{ method: "recovery" }]`,
      // issued by /auth/confirm after a valid recovery link) may use this
      // endpoint. A normal login session must use change-password with
      // currentPassword instead. The scope comes from the server-verified JWT
      // claims — never from body/query/header input. Same generic 401 as an
      // invalid session so token validity is not oracle-able.
      const recoveryClaims = await verifyAccessTokenClaims(accessToken);
      if (!isRecoverySession(recoveryClaims)) {
        await recordAuthEvent({
          event: "password_reset.denied",
          result: "denied",
          userId: recoveryClaims?.sub,
          method: "password",
          request,
          metadata: { reason: "not_recovery_session" },
        });
        throw ApiError.unauthorized(AUTH_ERRORS.invalidReset);
      }

      const userClient = createUserClient(accessToken);
      const result = await userClient.auth.updateUser({
        password: parsed.data.password,
      });
      if (result.error) {
        logAuthProviderError("reset-password", result.error);
        throw ApiError.validation(AUTH_ERRORS.unableToComplete);
      }

      // Invalidate all sessions after password change.
      try {
        await userClient.auth.signOut({ scope: "global" });
      } catch {
        // best-effort
      }

      const authUser = await verifyAccessToken(accessToken);
      clearSessionCookies(cookie as never);
      await recordAuthEvent({
        event: "password_reset.complete",
        result: "success",
        userId: authUser?.id ?? result.data.user?.id,
        sessionId: authUser?.sessionId,
        method: "password",
        request,
      });

      return { ok: true, redirectTo: "/login" };
    },
    {
      detail: {
        tags: ["Auth"],
        summary: "Reset password",
        requestBody: jsonBodyDetail(openApiBodies.resetPassword),
        ...secured(),
        ...apiDoc({
          ok: envelope({ ok: { type: "boolean" }, redirectTo: { type: "string" } }, [
            "ok",
            "redirectTo",
          ]),
          description:
            "Requires a recovery-scoped session (amr: recovery); normal " +
            "login sessions are rejected. Signs out all sessions on success.",
          errors: [400, 401, 429],
        }),
      },
    },
  )
  .post(
    "/change-password",
    async ({ cookie, accessToken, requireAuthz, request }) => {
      const ctx = await requireAuthz("profile.password.update");
      const body = await readJsonBody(request);
      const parsed = changePasswordSchema.safeParse(body);
      if (!parsed.success) {
        throw validationFromZod(
          AUTH_ERRORS.invalidDetails,
          parsed.error.flatten().fieldErrors,
        );
      }

      const email = ctx.subject.email;
      if (!email) {
        throw ApiError.unauthorized(AUTH_ERRORS.invalidCurrentPassword);
      }

      const supabase = createAnonClient();
      const verify = await supabase.auth.signInWithPassword({
        email,
        password: parsed.data.currentPassword,
      });
      if (verify.error || !verify.data.session || !verify.data.user) {
        logAuthProviderError("change-password.verify", verify.error);
        await recordAuthEvent({
          event: "password_change.failure",
          result: "failure",
          userId: ctx.subject.id,
          sessionId: ctx.subject.sessionId,
          method: "password",
          request,
          metadata: { reason: "invalid_current_password" },
        });
        throw ApiError.validation(AUTH_ERRORS.invalidCurrentPassword);
      }

      const userClient = createUserClient(accessToken!);
      const result = await userClient.auth.updateUser({
        password: parsed.data.password,
      });
      if (result.error) {
        logAuthProviderError("change-password", result.error);
        await recordAuthEvent({
          event: "password_change.failure",
          result: "failure",
          userId: ctx.subject.id,
          sessionId: ctx.subject.sessionId,
          method: "password",
          request,
          metadata: { reason: "provider_error" },
        });
        throw ApiError.validation(AUTH_ERRORS.unableToComplete);
      }

      await recordAuthEvent({
        event: "password_change.success",
        result: "success",
        userId: ctx.subject.id,
        sessionId: ctx.subject.sessionId,
        method: "password",
        request,
      });

      // Keep the session but rotate tokens so the new password is enforced
      // and old access/refresh JWTs are invalidated by Supabase.
      const refreshToken =
        typeof cookie[REFRESH_COOKIE]?.value === "string"
          ? cookie[REFRESH_COOKIE].value
          : null;
      if (refreshToken) {
        try {
          const rotated = await supabase.auth.refreshSession({
            refresh_token: refreshToken,
          });
          if (rotated.data.session) {
            setSessionCookies(
              cookie as never,
              rotated.data.session.access_token,
              rotated.data.session.refresh_token,
              rotated.data.session.expires_in,
            );
          }
        } catch (error) {
          console.warn(
            "[auth] change-password refresh:",
            error instanceof Error ? error.message : "unknown",
          );
        }
      }

      return { ok: true };
    },
    {
      detail: {
        tags: ["Auth"],
        summary: "Change password (signed in)",
        requestBody: jsonBodyDetail(openApiBodies.changePassword),
        ...secured(),
        ...apiDoc({
          ok: envelope({ ok: { type: "boolean" } }, ["ok"]),
          description: "Verifies `currentPassword` before updating.",
          errors: [400, 401, 403, 429],
        }),
      },
    },
  )
  .post(
    "/change-email",
    async ({ accessToken, requireAuthz, request }) => {
      const ctx = await requireAuthz("profile.email.update");
      const body = await readJsonBody(request);
      const parsed = changeEmailSchema.safeParse(body);
      if (!parsed.success) {
        throw validationFromZod(
          AUTH_ERRORS.invalidDetails,
          parsed.error.flatten().fieldErrors,
        );
      }

      const email = ctx.subject.email;
      if (!email) {
        throw ApiError.unauthorized(AUTH_ERRORS.invalidCurrentPassword);
      }

      const supabase = createAnonClient();
      const verify = await supabase.auth.signInWithPassword({
        email,
        password: parsed.data.currentPassword,
      });
      if (verify.error || !verify.data.session || !verify.data.user) {
        logAuthProviderError("change-email.verify", verify.error);
        await recordAuthEvent({
          event: "email_change.request_failed",
          result: "failure",
          userId: ctx.subject.id,
          sessionId: ctx.subject.sessionId,
          method: "password",
          request,
          metadata: { reason: "invalid_current_password" },
        });
        throw ApiError.validation(AUTH_ERRORS.invalidCurrentPassword);
      }

      const userClient = createUserClient(accessToken!);
      const result = await userClient.auth.updateUser({
        email: parsed.data.email,
      });
      if (result.error) {
        logAuthProviderError("change-email", result.error);
        await recordAuthEvent({
          event: "email_change.request_failed",
          result: "failure",
          userId: ctx.subject.id,
          sessionId: ctx.subject.sessionId,
          method: "email",
          request,
          metadata: { reason: "provider_error" },
        });
        throw ApiError.validation(AUTH_ERRORS.emailUnavailable);
      }

      await recordAuthEvent({
        event: "email_change.requested",
        result: "success",
        userId: ctx.subject.id,
        sessionId: ctx.subject.sessionId,
        method: "email",
        request,
        metadata: { to: parsed.data.email },
      });

      return {
        ok: true,
        message: "Check the new address to confirm the change.",
        pendingEmail: parsed.data.email,
      };
    },
    {
      detail: {
        tags: ["Auth"],
        summary: "Change email (signed in)",
        requestBody: jsonBodyDetail(openApiBodies.changeEmail),
        ...secured(),
        ...apiDoc({
          ok: envelope(
            {
              ok: { type: "boolean" },
              message: { type: "string" },
              pendingEmail: { type: "string" },
            },
            ["ok", "message", "pendingEmail"],
          ),
          description: "Verifies `currentPassword` before requesting.",
          errors: [400, 401, 403, 429],
        }),
      },
    },
  )
  .get(
    "/confirm",
    async ({ query, cookie, set, request }) => {
      const bridge = isAuthBridgeRequest(request);
      const supabase = createAnonClient();
      // Allow-listed internal path only; protocol-relative/absolute/
      // javascript:/data: inputs fall back to /summary (see validation).
      const next = resolveConfirmNextPath(query.next);

      let session: {
        access_token: string;
        refresh_token: string;
        expires_in: number;
      } | null = null;
      let userId: string | undefined;

      if (query.code) {
        const { data, error } = await supabase.auth.exchangeCodeForSession(
          query.code,
        );
        if (error || !data.session) {
          logAuthProviderError("confirm.code", error);
          await recordAuthEvent({
            event: "confirm.failure",
            result: "failure",
            method: "email",
            request,
          });
          throw ApiError.validation(AUTH_ERRORS.unableToComplete);
        }
        session = data.session;
        userId = data.user?.id;
      } else if (query.token_hash && query.type) {
        const { data, error } = await supabase.auth.verifyOtp({
          token_hash: query.token_hash,
          type: query.type as
            | "email"
            | "recovery"
            | "signup"
            | "invite"
            | "email_change",
        });
        if (error || !data.session) {
          logAuthProviderError("confirm.otp", error);
          await recordAuthEvent({
            event: "confirm.failure",
            result: "failure",
            method: "email",
            request,
          });
          throw ApiError.validation(AUTH_ERRORS.unableToComplete);
        }
        session = data.session;
        userId = data.user?.id;
      } else {
        throw ApiError.validation(AUTH_ERRORS.invalidDetails);
      }

      setSessionCookies(
        cookie as never,
        session.access_token,
        session.refresh_token,
        session.expires_in,
      );

      const authUser = await verifyAccessToken(session.access_token);
      await recordAuthEvent({
        event: "confirm.success",
        result: "success",
        userId: userId ?? authUser?.id,
        sessionId: authUser?.sessionId,
        method: "email",
        request,
      });

      if (bridge) {
        return withBridgeTokens(
          { ok: true, redirectTo: next },
          {
            accessToken: session.access_token,
            refreshToken: session.refresh_token,
            expiresIn: session.expires_in,
          },
          true,
        );
      }

      set.redirect = `${env.webOrigin}${next}`;
      return;
    },
    {
      query: t.Object({
        code: t.Optional(t.String()),
        token_hash: t.Optional(t.String()),
        type: t.Optional(t.String()),
        next: t.Optional(t.String()),
      }),
      detail: {
        tags: ["Auth"],
        summary: "Confirm email / recovery",
        description:
          "`next` must be an allow-listed internal path " +
          "(`/reset-password`, `/summary`); anything else falls back to " +
          "`/summary`. Bridge callers receive JSON; others get a 302.",
        ...apiDoc({
          ok: envelope(
            { ok: { type: "boolean" }, redirectTo: { type: "string" } },
            ["ok", "redirectTo"],
          ),
          errors: [400, 429],
          extraResponses: {
            302: {
              description:
                "Non-bridge success: redirect to `<web-origin><next>`.",
              headers: {
                Location: {
                  description: "Trusted same-origin redirect target.",
                  schema: { type: "string" },
                },
              },
            },
          },
        }),
      },
    },
  )
  .get(
    "/session",
    async ({ user, authz, cookie, accessToken, requireAuthz, set }) => {
      if (!user) {
        if (accessToken) {
          clearSessionCookies(cookie as never);
        }
        set.status = 401;
        return { authenticated: false };
      }
      // Authenticated session read requires profile.view (fail closed if no roles).
      if (!authz) {
        throw ApiError.forbidden();
      }
      await requireAuthz("profile.view");
      const [profile] = await getDb()
        .select()
        .from(profiles)
        .where(eq(profiles.id, user.id))
        .limit(1);

      // Surface a pending email change so the UI can show confirmation status.
      let pendingEmail: string | null = null;
      if (accessToken) {
        try {
          const userClient = createUserClient(accessToken);
          const current = await userClient.auth.getUser();
          const newEmail = current.data.user?.new_email;
          if (typeof newEmail === "string" && newEmail.length > 0) {
            pendingEmail = newEmail;
          }
        } catch {
          // best-effort; do not fail the session read
        }
      }

      return {
        authenticated: true,
        user: {
          id: user.id,
          email: user.email ?? profile?.email,
          timezone: profile?.timezone ?? "UTC",
          timeFormat: profile?.timeFormat ?? "24h",
          name: profile?.name ?? null,
          sessionId: user.sessionId ?? null,
          pendingEmail,
        },
      };
    },
    {
      detail: {
        tags: ["Auth"],
        summary: "Current session",
        ...secured(),
        ...apiDoc({
          ok: envelope(
            {
              authenticated: { type: "boolean" },
              user: R("SessionUser"),
            },
            ["authenticated", "user"],
          ),
          errors: [401, 403, 429],
          errorSchemas: {
            401: envelope({ authenticated: { type: "boolean" } }, [
              "authenticated",
            ]),
          },
        }),
      },
    },
  )
  .patch(
    "/timezone",
    async ({ requireAuthz, request }) => {
      const ctx = await requireAuthz("profile.timezone.update");
      const body = await readJsonBody(request);
      const parsed = timezoneUpdateSchema.safeParse(body);
      if (!parsed.success) {
        throw validationFromZod("Enter a valid timezone", parsed.error.flatten().fieldErrors);
      }
      const timezone = parsed.data.timezone;
      if (!isValidTimeZone(timezone)) {
        throw ApiError.validation("Enter a valid timezone", [{ field: "timezone", message: "Enter a valid timezone" }]);
      }
      await getDb()
        .update(profiles)
        .set({ timezone, updatedAt: new Date() })
        .where(eq(profiles.id, ctx.subject.id));
      return { ok: true, timezone };
    },
    {
      detail: {
        tags: ["Auth"],
        summary: "Update timezone",
        requestBody: jsonBodyDetail(openApiBodies.timezone),
        ...secured(),
        ...apiDoc({
          ok: envelope(
            { ok: { type: "boolean" }, timezone: { type: "string" } },
            ["ok", "timezone"],
          ),
          errors: [400, 401, 403, 429],
        }),
      },
    },
  )
  .patch(
    "/time-format",
    async ({ requireAuthz, request }) => {
      const ctx = await requireAuthz("profile.time-format.update");
      const body = await readJsonBody(request);
      const parsed = timeFormatUpdateSchema.safeParse(body);
      if (!parsed.success) {
        throw validationFromZod("Enter a valid time format", parsed.error.flatten().fieldErrors);
      }
      await getDb()
        .update(profiles)
        .set({ timeFormat: parsed.data.timeFormat, updatedAt: new Date() })
        .where(eq(profiles.id, ctx.subject.id));
      return { ok: true, timeFormat: parsed.data.timeFormat };
    },
    {
      detail: {
        tags: ["Auth"],
        summary: "Update time format",
        requestBody: jsonBodyDetail(openApiBodies.timeFormat),
        ...secured(),
        ...apiDoc({
          ok: envelope(
            {
              ok: { type: "boolean" },
              timeFormat: { type: "string", enum: ["24h", "12h"] },
            },
            ["ok", "timeFormat"],
          ),
          errors: [400, 401, 403, 429],
        }),
      },
    },
  );
