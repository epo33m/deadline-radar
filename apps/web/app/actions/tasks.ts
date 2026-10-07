"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { apiJson } from "@/lib/api/server";
import {
  generateIdempotencyKey,
  normalizeIdempotencyKey,
} from "@/lib/api/idempotency";
import { resolveSafeReturnTo } from "@deadline-radar/validation";

export type TaskActionState = {
  error?: string;
  fieldErrors?: Partial<Record<string, string[]>>;
  /** #136: definitive 4xx → the form regenerates its idempotency key. */
  renewKey?: boolean;
};

function taskBody(formData: FormData) {
  return {
    title: formData.get("title"),
    course_id: formData.get("course_id"),
    deadline: formData.get("deadline"),
    status: formData.get("status") || "todo",
    description: formData.get("description") || null,
  };
}

function revalidateTask(taskId?: string, courseId?: string) {
  revalidatePath("/tasks");
  revalidatePath("/summary");
  revalidatePath("/calendar");
  if (courseId) {
    revalidatePath(`/courses/${courseId}`, "page");
  } else {
    revalidatePath("/courses/[id]", "page");
  }
  if (taskId) revalidatePath(`/tasks/${taskId}`);
}

export async function createTask(
  _prev: TaskActionState,
  formData: FormData,
): Promise<TaskActionState> {
  const idemKey =
    normalizeIdempotencyKey(formData.get("idempotency_key")) ??
    generateIdempotencyKey();

  const result = await apiJson<{ task?: { id: string }; redirectTo?: string }>(
    "/api/v1/tasks",
    {
      method: "POST",
      headers: {
        "Idempotency-Key": idemKey,
      },
      body: JSON.stringify(taskBody(formData)),
    },
  );
  if (result.error) {
    return {
      error: result.error,
      fieldErrors: result.fieldErrors,
      renewKey: result.isRetryable === false,
    };
  }
  const returnTo = formData.get("return_to");
  const courseId = formData.get("course_id");
  revalidateTask(
    result.task?.id,
    typeof courseId === "string" && courseId ? courseId : undefined,
  );
  // SEC-001: never trust raw `return_to` — a bare `startsWith("/")` check
  // accepts protocol-relative `//evil.com`. Fall back to the
  // server-generated destination for anything that escapes our origin.
  const fallback = result.redirectTo ?? `/tasks/${result.task?.id}`;
  redirect(resolveSafeReturnTo(returnTo, fallback));
}

export async function updateTask(
  _prev: TaskActionState,
  formData: FormData,
): Promise<TaskActionState> {
  const id = formData.get("id");
  if (typeof id !== "string" || !id) return { error: "Task id is required." };
  const result = await apiJson(`/api/v1/tasks/${id}`, {
    method: "PATCH",
    body: JSON.stringify(taskBody(formData)),
  });
  if (result.error) {
    return { error: result.error, fieldErrors: result.fieldErrors };
  }
  const courseId = formData.get("course_id");
  revalidateTask(
    id,
    typeof courseId === "string" && courseId ? courseId : undefined,
  );
  return {};
}

export async function completeTask(
  _prev: TaskActionState,
  formData: FormData,
): Promise<TaskActionState> {
  const id = formData.get("id");
  if (typeof id !== "string" || !id) return { error: "Task id is required." };
  const result = await apiJson(`/api/v1/tasks/${id}/complete`, { method: "POST" });
  if (result.error) {
    return { error: result.error, fieldErrors: result.fieldErrors };
  }
  revalidateTask(id);
  return {};
}

export async function softDeleteTask(
  _prev: TaskActionState,
  formData: FormData,
): Promise<TaskActionState> {
  const id = formData.get("id");
  if (typeof id !== "string" || !id) return { error: "Task id is required." };
  const result = await apiJson(`/api/v1/tasks/${id}`, { method: "DELETE" });
  if (result.error) {
    return { error: result.error, fieldErrors: result.fieldErrors };
  }
  revalidateTask(id);
  redirect("/tasks");
}

export async function addReminderThreshold(
  _prev: TaskActionState,
  formData: FormData,
): Promise<TaskActionState> {
  const taskId = formData.get("task_id");
  if (typeof taskId !== "string" || !taskId) {
    return { error: "Task id is required." };
  }
  const days = Number(formData.get("days_before"));
  // RF-06: replay-safe add. The form carries a per-attempt key so a double
  // submit or browser retry returns the original response, not a 409.
  const idemKey =
    normalizeIdempotencyKey(formData.get("idempotency_key")) ??
    generateIdempotencyKey();
  const result = await apiJson(`/api/v1/tasks/${taskId}/thresholds`, {
    method: "POST",
    headers: { "Idempotency-Key": idemKey },
    body: JSON.stringify({ days_before: days }),
  });
  if (result.error) {
    return {
      error: result.error,
      fieldErrors: result.fieldErrors,
      renewKey: result.isRetryable === false,
    };
  }
  revalidateTask(taskId);
  return {};
}

export async function updateReminderThreshold(
  _prev: TaskActionState,
  formData: FormData,
): Promise<TaskActionState> {
  const taskId = formData.get("task_id");
  const id = formData.get("id");
  if (typeof taskId !== "string" || typeof id !== "string") {
    return { error: "Task and threshold ids are required." };
  }
  const days = Number(formData.get("days_before"));
  const result = await apiJson(`/api/v1/tasks/${taskId}/thresholds/${id}`, {
    method: "PATCH",
    body: JSON.stringify({ days_before: days }),
  });
  if (result.error) {
    return { error: result.error, fieldErrors: result.fieldErrors };
  }
  revalidateTask(taskId);
  return {};
}

export async function removeReminderThreshold(
  _prev: TaskActionState,
  formData: FormData,
): Promise<TaskActionState> {
  const taskId = formData.get("task_id");
  const id = formData.get("id");
  if (typeof taskId !== "string" || typeof id !== "string") {
    return { error: "Task and threshold ids are required." };
  }
  const result = await apiJson(`/api/v1/tasks/${taskId}/thresholds/${id}`, {
    method: "DELETE",
  });
  if (result.error) {
    return { error: result.error, fieldErrors: result.fieldErrors };
  }
  revalidateTask(taskId);
  return {};
}

const DEFAULT_REMINDER_OFFSETS = [7, 3, 1, 0] as const;

export async function setDefaultThresholds(
  _prev: TaskActionState,
  formData: FormData,
): Promise<TaskActionState> {
  const taskId = formData.get("task_id");
  if (typeof taskId !== "string" || !taskId) {
    return { error: "Task id is required." };
  }
  const enabled = formData.get("enabled") === "true";

  const detail = await apiJson<{
    thresholds?: { id: string; daysBefore: number }[];
  }>(`/api/v1/tasks/${taskId}`);
  if (detail.error) {
    return { error: detail.error };
  }

  const existingCustom = (detail.thresholds ?? [])
    .filter(
      (t) =>
        !(DEFAULT_REMINDER_OFFSETS as readonly number[]).includes(t.daysBefore),
    )
    .map((t) => ({ days_before: t.daysBefore }));

  const desiredDefaults = enabled
    ? DEFAULT_REMINDER_OFFSETS.map((offset) => ({ days_before: offset }))
    : [];

  const desiredThresholds = [...existingCustom, ...desiredDefaults];

  const result = await apiJson(`/api/v1/tasks/${taskId}/thresholds`, {
    method: "PUT",
    body: JSON.stringify({ thresholds: desiredThresholds }),
  });

  if (result.error) {
    return { error: result.error, fieldErrors: result.fieldErrors };
  }

  revalidateTask(taskId);
  return {};
}

