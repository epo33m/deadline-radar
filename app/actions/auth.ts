"use server";

import { redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";
import { loginSchema, registerSchema } from "@/lib/validation/auth";
import { timezoneSchema } from "@/lib/timezone";

export type AuthActionState = {
  error?: string;
  fieldErrors?: Partial<Record<string, string[]>>;
};

function firstIssueMessage(
  fieldErrors: Partial<Record<string, string[]>> | undefined,
): string | undefined {
  if (!fieldErrors) return undefined;
  for (const messages of Object.values(fieldErrors)) {
    if (messages?.[0]) return messages[0];
  }
  return undefined;
}

export async function register(
  _prev: AuthActionState,
  formData: FormData,
): Promise<AuthActionState> {
  const parsed = registerSchema.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
  });

  if (!parsed.success) {
    const fieldErrors = parsed.error.flatten().fieldErrors;
    return {
      error: firstIssueMessage(fieldErrors) ?? "Invalid registration details",
      fieldErrors,
    };
  }

  const timezoneRaw = formData.get("timezone");
  const timezoneParsed = timezoneSchema.safeParse(
    typeof timezoneRaw === "string" ? timezoneRaw : "UTC",
  );
  const timezone = timezoneParsed.success ? timezoneParsed.data : "UTC";

  const supabase = await createClient();
  const { data, error } = await supabase.auth.signUp({
    email: parsed.data.email,
    password: parsed.data.password,
  });

  if (error) {
    return { error: error.message };
  }

  if (data.session) {
    await supabase
      .from("profiles")
      .update({ timezone })
      .eq("id", data.session.user.id);
    redirect("/settings");
  }

  return {
    error:
      "Check your email to confirm your account before signing in. (Or disable email confirmation in Supabase Auth settings for local MVP.)",
  };
}

export async function login(
  _prev: AuthActionState,
  formData: FormData,
): Promise<AuthActionState> {
  const parsed = loginSchema.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
  });

  if (!parsed.success) {
    const fieldErrors = parsed.error.flatten().fieldErrors;
    return {
      error: firstIssueMessage(fieldErrors) ?? "Invalid login details",
      fieldErrors,
    };
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({
    email: parsed.data.email,
    password: parsed.data.password,
  });

  if (error) {
    return { error: error.message };
  }

  redirect("/dashboard");
}

export async function logout() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/login");
}

export async function updateTimezone(
  _prev: AuthActionState,
  formData: FormData,
): Promise<AuthActionState> {
  const parsed = timezoneSchema.safeParse(formData.get("timezone"));
  if (!parsed.success) {
    const message =
      parsed.error.issues[0]?.message ?? "Enter a valid IANA timezone";
    return {
      error: message,
      fieldErrors: { timezone: [message] },
    };
  }

  const supabase = await createClient();
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();

  if (userError || !user) {
    return { error: "You must be signed in to update timezone." };
  }

  const { error } = await supabase
    .from("profiles")
    .update({ timezone: parsed.data })
    .eq("id", user.id);

  if (error) {
    return { error: error.message };
  }

  return {};
}
