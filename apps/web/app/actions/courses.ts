"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { apiJson } from "@/lib/api/server";

/**
 * Revalidates every segment that renders a course's display (name, code,
 * color, icon): course list/detail plus tasks, calendar, and summary, which
 * all show course context. Without this, Back/forward navigation can restore a
 * stale segment from the Client Cache (HI-1).
 */
function revalidateCourseContent(courseId?: string) {
  revalidatePath("/courses");
  if (courseId) {
    revalidatePath(`/courses/${courseId}`);
  }
  revalidatePath("/tasks");
  revalidatePath("/calendar");
  revalidatePath("/summary");
}
import {
  generateIdempotencyKey,
  normalizeIdempotencyKey,
} from "@/lib/api/idempotency";
import { normalizeCourseColorForStorage } from "@/lib/courses/colors";
import { normalizeCourseIconForStorage } from "@/lib/courses/icons";

export type CourseActionState = {
  error?: string;
  fieldErrors?: Partial<Record<string, string[]>>;
  /** #136: definitive 4xx → the form regenerates its idempotency key. */
  renewKey?: boolean;
};

function courseBody(formData: FormData) {
  const colorRaw = formData.get("color");
  const color =
    typeof colorRaw === "string"
      ? normalizeCourseColorForStorage(colorRaw)
      : "";
  const iconRaw = formData.get("icon");
  const icon =
    typeof iconRaw === "string" ? normalizeCourseIconForStorage(iconRaw) : "";
  return {
    name: formData.get("name"),
    code: formData.get("code") || null,
    color: color.length > 0 ? color : null,
    icon: icon.length > 0 ? icon : null,
    description: formData.get("description") || null,
  };
}

export async function createCourse(
  _prev: CourseActionState,
  formData: FormData,
): Promise<CourseActionState> {
  const idemKey =
    normalizeIdempotencyKey(formData.get("idempotency_key")) ??
    generateIdempotencyKey();

  const result = await apiJson("/api/v1/courses", {
    method: "POST",
    headers: {
      "Idempotency-Key": idemKey,
    },
    body: JSON.stringify(courseBody(formData)),
  });
  if (result.error) {
    return {
      error: result.error,
      fieldErrors: result.fieldErrors,
      renewKey: result.isRetryable === false,
    };
  }
  revalidateCourseContent();
  return {};
}

export async function updateCourse(
  _prev: CourseActionState,
  formData: FormData,
): Promise<CourseActionState> {
  const id = formData.get("id");
  if (typeof id !== "string" || !id) {
    return { error: "Course id is required." };
  }
  const result = await apiJson(`/api/v1/courses/${id}`, {
    method: "PATCH",
    body: JSON.stringify(courseBody(formData)),
  });
  if (result.error) {
    return { error: result.error, fieldErrors: result.fieldErrors };
  }
  revalidateCourseContent(id);
  return {};
}

export async function softDeleteCourse(
  _prev: CourseActionState,
  formData: FormData,
): Promise<CourseActionState> {
  const id = formData.get("id");
  if (typeof id !== "string" || !id) {
    return { error: "Course id is required." };
  }
  const result = await apiJson(`/api/v1/courses/${id}`, { method: "DELETE" });
  if (result.error) {
    return { error: result.error, fieldErrors: result.fieldErrors };
  }
  revalidateCourseContent(id);
  redirect("/courses");
}
