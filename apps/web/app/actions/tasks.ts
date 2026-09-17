"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { apiJson } from "@/lib/api/server";

export type TaskActionState = {
  error?: string;
  fieldErrors?: Partial<Record<string, string[]>>;
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

function revalidateTask(taskId?: string) {
  revalidatePath("/tasks");
  revalidatePath("/summary");
  revalidatePath("/calendar");
  revalidatePath("/courses/[id]", "page");
  if (taskId) revalidatePath(`/tasks/${taskId}`);
}

export async function createTask(
  _prev: TaskActionState,
  formData: FormData,
): Promise<TaskActionState> {
  const result = await apiJson<{ task?: { id: string }; redirectTo?: string }>(
    "/api/v1/tasks",
    {
      method: "POST",
      body: JSON.stringify(taskBody(formData)),
    },
  );
  if (result.error) {
    return { error: result.error, fieldErrors: result.fieldErrors };
  }
  const returnTo = formData.get("return_to");
  revalidateTask(result.task?.id);
  if (typeof returnTo === "string" && returnTo.startsWith("/")) {
    redirect(returnTo);
  }
  redirect(result.redirectTo ?? `/tasks/${result.task?.id}`);
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
  revalidateTask(id);
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
  const result = await apiJson(`/api/v1/tasks/${taskId}/thresholds`, {
    method: "POST",
    body: JSON.stringify({ days_before: days }),
  });
  if (result.error) {
    return { error: result.error, fieldErrors: result.fieldErrors };
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

  const byOffset = new Map(
    (detail.thresholds ?? [])
      .filter((t) =>
        (DEFAULT_REMINDER_OFFSETS as readonly number[]).includes(t.daysBefore),
      )
      .map((t) => [t.daysBefore, t.id]),
  );

  const calls = enabled
    ? DEFAULT_REMINDER_OFFSETS.filter((offset) => !byOffset.has(offset)).map(
        (offset) =>
          apiJson(`/api/v1/tasks/${taskId}/thresholds`, {
            method: "POST",
            body: JSON.stringify({ days_before: offset }),
          }),
      )
    : DEFAULT_REMINDER_OFFSETS.filter((offset) => byOffset.has(offset)).map(
        (offset) =>
          apiJson(`/api/v1/tasks/${taskId}/thresholds/${byOffset.get(offset)}`, {
            method: "DELETE",
          }),
      );

  const results = await Promise.allSettled(calls);
  for (const result of results) {
    if (result.status === "rejected") {
      return { error: "Failed to update default reminders." };
    }
    if (result.value?.error) {
      return { error: result.value.error };
    }
  }

  revalidateTask(taskId);
  return {};
}
