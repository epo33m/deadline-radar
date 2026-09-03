"use server";

import { revalidatePath } from "next/cache";

import { createClient } from "@/lib/supabase/server";
import { normalizeCourseColorForStorage } from "@/lib/courses/colors";
import { courseSchema } from "@/lib/validation/course";

export type CourseActionState = {
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

function parseCourseForm(formData: FormData) {
  const colorRaw = formData.get("color");
  const color =
    typeof colorRaw === "string"
      ? normalizeCourseColorForStorage(colorRaw)
      : "";

  return courseSchema.safeParse({
    name: formData.get("name"),
    code: formData.get("code") ?? undefined,
    color: color.length > 0 ? color : null,
  });
}

async function requireUser() {
  const supabase = await createClient();
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();

  if (error || !user) {
    return { supabase, user: null as null, error: "You must be signed in." };
  }

  return { supabase, user, error: null as null };
}

export async function createCourse(
  _prev: CourseActionState,
  formData: FormData,
): Promise<CourseActionState> {
  const parsed = parseCourseForm(formData);
  if (!parsed.success) {
    const fieldErrors = parsed.error.flatten().fieldErrors;
    return {
      error: firstIssueMessage(fieldErrors) ?? "Invalid course details",
      fieldErrors,
    };
  }

  const { supabase, user, error: authError } = await requireUser();
  if (authError || !user) {
    return { error: authError ?? "You must be signed in." };
  }

  const { error } = await supabase.from("courses").insert({
    user_id: user.id,
    name: parsed.data.name,
    code: parsed.data.code,
    color: parsed.data.color,
  });

  if (error) {
    return { error: error.message };
  }

  revalidatePath("/courses");
  return {};
}

export async function updateCourse(
  _prev: CourseActionState,
  formData: FormData,
): Promise<CourseActionState> {
  const id = formData.get("id");
  if (typeof id !== "string" || id.length === 0) {
    return { error: "Course id is required." };
  }

  const parsed = parseCourseForm(formData);
  if (!parsed.success) {
    const fieldErrors = parsed.error.flatten().fieldErrors;
    return {
      error: firstIssueMessage(fieldErrors) ?? "Invalid course details",
      fieldErrors,
    };
  }

  const { supabase, user, error: authError } = await requireUser();
  if (authError || !user) {
    return { error: authError ?? "You must be signed in." };
  }

  const { data, error } = await supabase
    .from("courses")
    .update({
      name: parsed.data.name,
      code: parsed.data.code,
      color: parsed.data.color,
    })
    .eq("id", id)
    .eq("user_id", user.id)
    .is("deleted_at", null)
    .select("id")
    .maybeSingle();

  if (error) {
    return { error: error.message };
  }
  if (!data) {
    return { error: "Course not found." };
  }

  revalidatePath("/courses");
  revalidatePath(`/courses/${id}`);
  return {};
}

export async function softDeleteCourse(
  _prev: CourseActionState,
  formData: FormData,
): Promise<CourseActionState> {
  const id = formData.get("id");
  if (typeof id !== "string" || id.length === 0) {
    return { error: "Course id is required." };
  }

  const { supabase, user, error: authError } = await requireUser();
  if (authError || !user) {
    return { error: authError ?? "You must be signed in." };
  }

  const { data, error } = await supabase
    .from("courses")
    .update({ deleted_at: new Date().toISOString() })
    .eq("id", id)
    .eq("user_id", user.id)
    .is("deleted_at", null)
    .select("id")
    .maybeSingle();

  if (error) {
    return { error: error.message };
  }
  if (!data) {
    return { error: "Course not found." };
  }

  revalidatePath("/courses");
  revalidatePath(`/courses/${id}`);
  return {};
}
