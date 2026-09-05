import { Elysia, t } from "elysia";
import { eq } from "drizzle-orm";
import {
  forgotPasswordSchema,
  loginSchema,
  registerSchema,
  resetPasswordSchema,
  timezoneUpdateSchema,
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
  cookieOptions,
  verifyAccessToken,
} from "../lib/auth-tokens";
import {
  isAuthBridgeRequest,
  withBridgeTokens,
} from "../lib/auth-bridge";
import { recordAuthEvent } from "../lib/auth-audit";
import {
  clearLoginFailures,
  clientIpFromRequest,
  getLoginDelayMs,
  loginAttemptKey,
  recordLoginFailure,
} from "../lib/auth-abuse";
import { AUTH_ERRORS, logAuthProviderError } from "../lib/auth-errors";
import { ApiError, validationFromZod } from "../lib/api/errors";
import { readJsonBody, jsonBodyDetail, openApiBodies } from "../lib/api";
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
  cookie[ACCESS_COOKIE].remove();
  cookie[REFRESH_COOKIE].remove();
}

function readRefreshCookie(cookie: CookieBag): string | null {
  const value = cookie[REFRESH_COOKIE]?.value;
  return typeof value === "string" && value.length > 0 ? value : null;
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
        throw ApiError.validation(AUTH_ERRORS.registrationFailed);
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
            redirectTo: "/preferences",
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
      return {
        message:
          "Check your email to confirm your account before signing in. (Or disable email confirmation in Supabase Auth settings for local MVP.)",
      };
    },
    {
      detail: {
        tags: ["Auth"],
        summary: "Register",
        requestBody: jsonBodyDetail(openApiBodies.register),
      },
    },
  )
  .post(
    "/login",
    async ({ cookie, set, request }) => {
      const bridge = isAuthBridgeRequest(request);
      const body = await readJsonBody(request);
      const parsed = loginSchema.safeParse(body);
      if (!parsed.success) {
        throw validationFromZod(
          AUTH_ERRORS.invalidDetails,
          parsed.error.flatten().fieldErrors,
        );
      }

      const ip = clientIpFromRequest(request);
      const attemptKey = loginAttemptKey(parsed.data.email, ip);
      const delayMs = getLoginDelayMs(attemptKey);
      if (delayMs > 0) {
        await recordAuthEvent({
          event: "login.failure_rate_limited",
          result: "denied",
          method: "password",
          request,
          metadata: { delayMs },
        });
        set.headers["Retry-After"] = String(Math.ceil(delayMs / 1000));
        throw ApiError.rateLimited(AUTH_ERRORS.rateLimited);
      }

      const supabase = createAnonClient();
      const { data, error } = await supabase.auth.signInWithPassword({
        email: parsed.data.email,
        password: parsed.data.password,
      });

      if (error || !data.session || !data.user) {
        logAuthProviderError("login", error);
        const nextDelay = recordLoginFailure(attemptKey);
        await recordAuthEvent({
          event: "login.failure",
          result: "failure",
          method: "password",
          request,
          metadata: nextDelay > 0 ? { delayMs: nextDelay } : undefined,
        });
        throw ApiError.unauthorized(AUTH_ERRORS.invalidCredentials);
      }

      clearLoginFailures(attemptKey);
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
          redirectTo: "/dashboard",
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
    { detail: { tags: ["Auth"], summary: "Refresh session" } },
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
    { detail: { tags: ["Auth"], summary: "Logout current session" } },
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
    { detail: { tags: ["Auth"], summary: "Logout all sessions" } },
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

      const origin =
        request.headers.get("origin") ??
        request.headers.get("x-forwarded-host") ??
        env.webOrigin;
      const base = origin.includes("://")
        ? origin.replace(/\/$/, "")
        : env.webOrigin.replace(/\/$/, "");
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
      },
    },
  )
  .get(
    "/confirm",
    async ({ query, cookie, set, request }) => {
      const bridge = isAuthBridgeRequest(request);
      const supabase = createAnonClient();
      const next =
        typeof query.next === "string" && query.next.startsWith("/")
          ? query.next
          : "/dashboard";

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
          type: query.type as "email" | "recovery" | "signup" | "invite",
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
      detail: { tags: ["Auth"], summary: "Confirm email / recovery" },
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

      return {
        authenticated: true,
        user: {
          id: user.id,
          email: user.email ?? profile?.email,
          timezone: profile?.timezone ?? "UTC",
          name: profile?.name ?? null,
          sessionId: user.sessionId ?? null,
        },
      };
    },
    { detail: { tags: ["Auth"], summary: "Current session" } },
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
        .set({ timezone })
        .where(eq(profiles.id, ctx.subject.id));
      return { ok: true, timezone };
    },
    {
      detail: {
        tags: ["Auth"],
        summary: "Update timezone",
        requestBody: jsonBodyDetail(openApiBodies.timezone),
      },
    },
  );
