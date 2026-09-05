"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { apiJson } from "@/lib/api/server";

export type AuthActionState = {
  error?: string;
  success?: string;
  fieldErrors?: Partial<Record<string, string[]>>;
  redirectTo?: string;
};

const ACCESS_COOKIE = "dr_access_token";
const REFRESH_COOKIE = "dr_refresh_token";

async function persistSessionCookies(input: {
  accessToken?: string;
  refreshToken?: string;
  expiresIn?: number;
}) {
  if (!input.accessToken || !input.refreshToken) return;
  const store = await cookies();
  const secure = process.env.NODE_ENV === "production";
  store.set(ACCESS_COOKIE, input.accessToken, {
    httpOnly: true,
    secure,
    sameSite: "lax",
    path: "/",
    maxAge: input.expiresIn ?? 60 * 60,
  });
  store.set(REFRESH_COOKIE, input.refreshToken, {
    httpOnly: true,
    secure,
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 30,
  });
}

export async function register(
  _prev: AuthActionState,
  formData: FormData,
): Promise<AuthActionState> {
  const result = await apiJson<{
    redirectTo?: string;
    message?: string;
    accessToken?: string;
    refreshToken?: string;
    expiresIn?: number;
  }>("/api/auth/register", {
    method: "POST",
    body: JSON.stringify({
      email: formData.get("email"),
      password: formData.get("password"),
      timezone: formData.get("timezone") ?? "UTC",
    }),
  });

  if (result.error) {
    return {
      error: result.error,
      fieldErrors: result.fieldErrors,
    };
  }

  await persistSessionCookies(result);

  if (result.redirectTo) {
    redirect(result.redirectTo);
  }

  return {
    error:
      result.message ??
      "Check your email to confirm your account before signing in.",
  };
}

export async function login(
  _prev: AuthActionState,
  formData: FormData,
): Promise<AuthActionState> {
  const result = await apiJson<{
    redirectTo?: string;
    accessToken?: string;
    refreshToken?: string;
    expiresIn?: number;
  }>("/api/auth/login", {
    method: "POST",
    body: JSON.stringify({
      email: formData.get("email"),
      password: formData.get("password"),
    }),
  });

  if (result.error) {
    return {
      error: result.error,
      fieldErrors: result.fieldErrors,
    };
  }

  await persistSessionCookies(result);
  redirect(result.redirectTo ?? "/dashboard");
}

export async function requestPasswordReset(
  _prev: AuthActionState,
  formData: FormData,
): Promise<AuthActionState> {
  const result = await apiJson<{ success?: string }>(
    "/api/auth/forgot-password",
    {
      method: "POST",
      body: JSON.stringify({ email: formData.get("email") }),
    },
  );

  if (result.error) {
    return {
      error: result.error,
      fieldErrors: result.fieldErrors,
    };
  }

  return {
    success:
      result.success ??
      "If that email is registered, you will receive a reset link shortly.",
  };
}

export async function updatePassword(
  _prev: AuthActionState,
  formData: FormData,
): Promise<AuthActionState> {
  const result = await apiJson<{ redirectTo?: string }>(
    "/api/auth/reset-password",
    {
      method: "POST",
      body: JSON.stringify({
        password: formData.get("password"),
        confirmPassword: formData.get("confirmPassword"),
      }),
    },
  );

  if (result.error) {
    return {
      error: result.error,
      fieldErrors: result.fieldErrors,
    };
  }

  redirect(result.redirectTo ?? "/login");
}

export async function logout() {
  await apiJson("/api/auth/logout", { method: "POST" });
  const store = await cookies();
  store.delete(ACCESS_COOKIE);
  store.delete(REFRESH_COOKIE);
  redirect("/login");
}

export async function updateTimezone(
  _prev: AuthActionState,
  formData: FormData,
): Promise<AuthActionState> {
  const result = await apiJson("/api/auth/timezone", {
    method: "PATCH",
    body: JSON.stringify({ timezone: formData.get("timezone") }),
  });

  if (result.error) {
    return { error: result.error, fieldErrors: result.fieldErrors };
  }

  return { success: "Timezone updated." };
}
