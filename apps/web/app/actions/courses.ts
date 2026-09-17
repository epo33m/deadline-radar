"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { apiJson } from "@/lib/api/server";
import { normalizeCourseColorForStorage } from "@/lib/courses/colors";
import { normalizeCourseIconForStorage } from "@/lib/courses/icons";

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
  const result = await apiJson("/api/v1/courses", {
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
  const result = await apiJson(`/api/v1/courses/${id}`, {
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
  const result = await apiJson(`/api/v1/courses/${id}`, { method: "DELETE" });
  if (result.error) {
    return { error: result.error, fieldErrors: result.fieldErrors };
  }
  revalidatePath("/courses");
  redirect("/courses");
}
