"use server";

import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { apiJson } from "@/lib/api/server";
import {
  ACCESS_COOKIE,
  REFRESH_COOKIE,
  clearedAuthCookieOptions,
} from "@/lib/auth/cookies";
import { resolveSafeReturnTo } from "@deadline-radar/validation";

export type AuthActionState = {
  error?: string;
  success?: string;
  fieldErrors?: Partial<Record<string, string[]>>;
  redirectTo?: string;
};

export async function register(
  _prev: AuthActionState,
  formData: FormData,
): Promise<AuthActionState> {
  const result = await apiJson<{
    redirectTo?: string;
    message?: string;
  }>("/api/v1/auth/register", {
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

  if (result.redirectTo) {
    // SEC-005: validate backend-issued redirect; on invalid values stay on
    // the page (show the confirmation message below) instead of navigating.
    const safe = resolveSafeReturnTo(result.redirectTo, "");
    if (safe !== "") redirect(safe);
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
  }>("/api/v1/auth/login", {
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

  // SEC-005: never trust redirectTo blindly — validate, fall back internal.
  redirect(resolveSafeReturnTo(result.redirectTo, "/summary"));
}

export async function requestPasswordReset(
  _prev: AuthActionState,
  formData: FormData,
): Promise<AuthActionState> {
  const result = await apiJson<{ success?: string }>(
    "/api/v1/auth/forgot-password",
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
    "/api/v1/auth/reset-password",
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

  // SEC-005: never trust redirectTo blindly — validate, fall back internal.
  redirect(resolveSafeReturnTo(result.redirectTo, "/login"));
}

export async function changePassword(
  _prev: AuthActionState,
  formData: FormData,
): Promise<AuthActionState> {
  const result = await apiJson("/api/v1/auth/change-password", {
    method: "POST",
    body: JSON.stringify({
      currentPassword: formData.get("currentPassword"),
      password: formData.get("password"),
      confirmPassword: formData.get("confirmPassword"),
    }),
  });

  if (result.error) {
    return {
      error: result.error,
      fieldErrors: result.fieldErrors,
    };
  }

  return { success: "Password updated." };
}

export async function changeEmail(
  _prev: AuthActionState,
  formData: FormData,
): Promise<AuthActionState> {
  const result = await apiJson<{ pendingEmail?: string }>(
    "/api/v1/auth/change-email",
    {
      method: "POST",
      body: JSON.stringify({
        email: formData.get("email"),
        currentPassword: formData.get("currentPassword"),
      }),
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
      result.message ??
      "Check the new address to confirm the change. Your email stays unchanged until then.",
  };
}

export async function logout() {
  await apiJson("/api/v1/auth/logout", { method: "POST" });
  const store = await cookies();
  store.set(ACCESS_COOKIE, "", clearedAuthCookieOptions());
  store.set(REFRESH_COOKIE, "", clearedAuthCookieOptions());
  redirect("/login");
}

export async function logoutAll() {
  await apiJson("/api/v1/auth/logout-all", { method: "POST" });
  const store = await cookies();
  store.set(ACCESS_COOKIE, "", clearedAuthCookieOptions());
  store.set(REFRESH_COOKIE, "", clearedAuthCookieOptions());
  redirect("/login");
}

export async function updateTimezone(
  _prev: AuthActionState,
  formData: FormData,
): Promise<AuthActionState> {
  const result = await apiJson("/api/v1/auth/timezone", {
    method: "PATCH",
    body: JSON.stringify({ timezone: formData.get("timezone") }),
  });

  if (result.error) {
    return { error: result.error, fieldErrors: result.fieldErrors };
  }

  revalidatePath("/", "layout");
  return { success: "Timezone updated." };
}

export async function updateTimeFormat(
  _prev: AuthActionState,
  formData: FormData,
): Promise<AuthActionState> {
  const result = await apiJson("/api/v1/auth/time-format", {
    method: "PATCH",
    body: JSON.stringify({ timeFormat: formData.get("timeFormat") }),
  });

  if (result.error) {
    return { error: result.error, fieldErrors: result.fieldErrors };
  }

  revalidatePath("/", "layout");
  return { success: "Time format updated." };
}
