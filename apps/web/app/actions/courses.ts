"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { apiJson } from "@/lib/api/server";
import { normalizeCourseColorForStorage } from "@/lib/courses/colors";

export type CourseActionState = {
  error?: string;
  fieldErrors?: Partial<Record<string, string[]>>;
};

function courseBody(formData: FormData) {
  const colorRaw = formData.get("color");
  const color =
    typeof colorRaw === "string"
      ? normalizeCourseColorForStorage(colorRaw)
      : "";
  return {
    name: formData.get("name"),
    code: formData.get("code") || null,
    color: color.length > 0 ? color : null,
  };
}

export async function createCourse(
  _prev: CourseActionState,
  formData: FormData,
): Promise<CourseActionState> {
  const result = await apiJson("/api/courses", {
    method: "POST",
    body: JSON.stringify(courseBody(formData)),
  });
  if (result.error) {
    return { error: result.error, fieldErrors: result.fieldErrors };
  }
  revalidatePath("/courses");
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
  const result = await apiJson(`/api/courses/${id}`, {
    method: "PATCH",
    body: JSON.stringify(courseBody(formData)),
  });
  if (result.error) {
    return { error: result.error, fieldErrors: result.fieldErrors };
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
  if (typeof id !== "string" || !id) {
    return { error: "Course id is required." };
  }
  const result = await apiJson(`/api/courses/${id}`, { method: "DELETE" });
  if (result.error) {
    return { error: result.error, fieldErrors: result.fieldErrors };
  }
  revalidatePath("/courses");
  redirect("/courses");
}
