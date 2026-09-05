import { Elysia, t } from "elysia";
import { eq } from "drizzle-orm";
import {
  forgotPasswordSchema,
  loginSchema,
  registerSchema,
  resetPasswordSchema,
} from "@deadline-radar/validation";
import { profiles } from "@deadline-radar/db";

import { authPlugin } from "../plugins/auth";
import { getDb } from "../lib/db";
import { createAnonClient } from "../lib/supabase";
import {
  ACCESS_COOKIE,
  REFRESH_COOKIE,
  cookieOptions,
} from "../lib/auth-tokens";
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

function setSessionCookies(
  cookie: Record<string, { set: (v: unknown) => void; remove: () => void }>,
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
    ...cookieOptions(60 * 60 * 24 * 30),
  });
}

function clearSessionCookies(
  cookie: Record<string, { set: (v: unknown) => void; remove: () => void }>,
) {
  cookie[ACCESS_COOKIE].remove();
  cookie[REFRESH_COOKIE].remove();
}

export const authRoutes = new Elysia({ prefix: "/api/auth" })
  .use(authPlugin)
  .post(
    "/register",
    async ({ body, cookie, set }) => {
      const parsed = registerSchema.safeParse(body);
      if (!parsed.success) {
        set.status = 400;
        return {
          error: "Invalid registration details",
          fieldErrors: parsed.error.flatten().fieldErrors,
        };
      }

      const timezone =
        typeof body.timezone === "string" && isValidTimeZone(body.timezone)
          ? body.timezone
          : "UTC";

      const supabase = createAnonClient();
      const { data, error } = await supabase.auth.signUp({
        email: parsed.data.email,
        password: parsed.data.password,
      });

      if (error) {
        set.status = 400;
        return { error: error.message };
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

        return {
          user: { id: data.user.id, email: data.user.email },
          redirectTo: "/preferences",
          accessToken: data.session.access_token,
          refreshToken: data.session.refresh_token,
          expiresIn: data.session.expires_in,
        };
      }

      set.status = 202;
      return {
        message:
          "Check your email to confirm your account before signing in. (Or disable email confirmation in Supabase Auth settings for local MVP.)",
      };
    },
    {
      body: t.Object({
        email: t.String(),
        password: t.String(),
        timezone: t.Optional(t.String()),
      }),
      detail: { tags: ["Auth"], summary: "Register" },
    },
  )
  .post(
    "/login",
    async ({ body, cookie, set }) => {
      const parsed = loginSchema.safeParse(body);
      if (!parsed.success) {
        set.status = 400;
        return {
          error: "Invalid login details",
          fieldErrors: parsed.error.flatten().fieldErrors,
        };
      }

      const supabase = createAnonClient();
      const { data, error } = await supabase.auth.signInWithPassword({
        email: parsed.data.email,
        password: parsed.data.password,
      });

      if (error || !data.session || !data.user) {
        set.status = 401;
        return { error: error?.message ?? "Invalid credentials" };
      }

      setSessionCookies(
        cookie as never,
        data.session.access_token,
        data.session.refresh_token,
        data.session.expires_in,
      );

      return {
        user: { id: data.user.id, email: data.user.email },
        redirectTo: "/dashboard",
        accessToken: data.session.access_token,
        refreshToken: data.session.refresh_token,
        expiresIn: data.session.expires_in,
      };
    },
    {
      body: t.Object({
        email: t.String(),
        password: t.String(),
      }),
      detail: { tags: ["Auth"], summary: "Login" },
    },
  )
  .post(
    "/logout",
    async ({ cookie, accessToken }) => {
      if (accessToken) {
        const supabase = createAnonClient();
        await supabase.auth.signOut();
      }
      clearSessionCookies(cookie as never);
      return { ok: true, redirectTo: "/login" };
    },
    { detail: { tags: ["Auth"], summary: "Logout" } },
  )
  .post(
    "/forgot-password",
    async ({ body, set, request }) => {
      const parsed = forgotPasswordSchema.safeParse(body);
      if (!parsed.success) {
        set.status = 400;
        return {
          error: "Invalid email",
          fieldErrors: parsed.error.flatten().fieldErrors,
        };
      }

      const origin =
        request.headers.get("origin") ??
        request.headers.get("x-forwarded-host") ??
        env.webOrigin;
      const redirectTo = `${origin.replace(/\/$/, "")}/auth/confirm?next=/reset-password`;

      const supabase = createAnonClient();
      const { error } = await supabase.auth.resetPasswordForEmail(
        parsed.data.email,
        { redirectTo },
      );

      if (error) {
        set.status = 400;
        return { error: error.message };
      }

      return {
        success:
          "If that email is registered, you will receive a reset link shortly.",
      };
    },
    {
      body: t.Object({ email: t.String() }),
      detail: { tags: ["Auth"], summary: "Request password reset" },
    },
  )
  .post(
    "/reset-password",
    async ({ body, cookie, accessToken, set }) => {
      const parsed = resetPasswordSchema.safeParse(body);
      if (!parsed.success) {
        set.status = 400;
        return {
          error: "Invalid password",
          fieldErrors: parsed.error.flatten().fieldErrors,
        };
      }

      if (!accessToken) {
        set.status = 401;
        return { error: "Unauthorized" };
      }

      const { createUserClient } = await import("../lib/supabase");
      const userClient = createUserClient(accessToken);
      const result = await userClient.auth.updateUser({
        password: parsed.data.password,
      });
      if (result.error) {
        set.status = 400;
        return { error: result.error.message };
      }

      clearSessionCookies(cookie as never);
      return { ok: true, redirectTo: "/login" };
    },
    {
      body: t.Object({
        password: t.String(),
        confirmPassword: t.String(),
      }),
      detail: { tags: ["Auth"], summary: "Reset password" },
    },
  )
  .get(
    "/confirm",
    async ({ query, cookie, set }) => {
      const supabase = createAnonClient();
      const next =
        typeof query.next === "string" && query.next.startsWith("/")
          ? query.next
          : "/dashboard";

      if (query.code) {
        const { data, error } = await supabase.auth.exchangeCodeForSession(
          query.code,
        );
        if (error || !data.session) {
          set.status = 400;
          return { error: error?.message ?? "Invalid confirmation code" };
        }
        setSessionCookies(
          cookie as never,
          data.session.access_token,
          data.session.refresh_token,
          data.session.expires_in,
        );
        set.redirect = `${env.webOrigin}${next}`;
        return;
      }

      if (query.token_hash && query.type) {
        const { data, error } = await supabase.auth.verifyOtp({
          token_hash: query.token_hash,
          type: query.type as "email" | "recovery" | "signup" | "invite",
        });
        if (error || !data.session) {
          set.status = 400;
          return { error: error?.message ?? "Invalid token" };
        }
        setSessionCookies(
          cookie as never,
          data.session.access_token,
          data.session.refresh_token,
          data.session.expires_in,
        );
        set.redirect = `${env.webOrigin}${next}`;
        return;
      }

      set.status = 400;
      return { error: "Missing confirmation parameters" };
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
    async ({ user, cookie, accessToken, set }) => {
      if (!user) {
        // Stale/invalid JWT → clear cookies so the Next proxy cannot redirect-loop.
        if (accessToken) {
          clearSessionCookies(cookie as never);
        }
        set.status = 401;
        return { authenticated: false };
      }
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
        },
      };
    },
    { detail: { tags: ["Auth"], summary: "Current session" } },
  )
  .patch(
    "/timezone",
    async ({ body, requireUser, set }) => {
      const user = requireUser();
      const timezone = body.timezone;
      if (!isValidTimeZone(timezone)) {
        set.status = 400;
        return { error: "Enter a valid timezone" };
      }
      await getDb()
        .update(profiles)
        .set({ timezone })
        .where(eq(profiles.id, user.id));
      return { ok: true, timezone };
    },
    {
      body: t.Object({ timezone: t.String() }),
      detail: { tags: ["Auth"], summary: "Update timezone" },
    },
  );
