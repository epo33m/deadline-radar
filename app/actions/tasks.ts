"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";
import {
  reminderThresholdSchema,
  taskSchema,
} from "@/lib/validation/task";

export type TaskActionState = {
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

function parseTaskForm(formData: FormData) {
  return taskSchema.safeParse({
    title: formData.get("title"),
    course_id: formData.get("course_id"),
    deadline: formData.get("deadline"),
    status: formData.get("status"),
    description: formData.get("description") ?? undefined,
    estimated_duration: formData.get("estimated_duration") ?? undefined,
  });
}

function isUniqueViolation(error: { code?: string; message: string }): boolean {
  return (
    error.code === "23505" ||
    /duplicate key|unique constraint/i.test(error.message)
  );
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

async function assertOwnedCourse(
  supabase: Awaited<ReturnType<typeof createClient>>,
  userId: string,
  courseId: string,
  options: { requireActive: boolean },
) {
  let query = supabase
    .from("courses")
    .select("id")
    .eq("id", courseId)
    .eq("user_id", userId);

  if (options.requireActive) {
    query = query.is("deleted_at", null);
  }

  const { data, error } = await query.maybeSingle();

  if (error) {
    return error.message;
  }
  if (!data) {
    return options.requireActive
      ? "Course not found or is no longer active."
      : "Course not found.";
  }
  return null;
}

async function assertOwnedActiveTask(
  supabase: Awaited<ReturnType<typeof createClient>>,
  userId: string,
  taskId: string,
) {
  const { data, error } = await supabase
    .from("tasks")
    .select("id")
    .eq("id", taskId)
    .eq("user_id", userId)
    .is("deleted_at", null)
    .maybeSingle();

  if (error) {
    return error.message;
  }
  if (!data) {
    return "Task not found.";
  }
  return null;
}

function revalidateTaskPaths(taskId?: string, courseId?: string) {
  revalidatePath("/dashboard");
  revalidatePath("/calendar");
  revalidatePath("/tasks");
  revalidatePath("/courses");
  if (taskId) {
    revalidatePath(`/tasks/${taskId}`);
  }
  if (courseId) {
    revalidatePath(`/courses/${courseId}`);
  }
}

function safeReturnPath(value: FormDataEntryValue | null): string | null {
  if (typeof value !== "string" || !value.startsWith("/") || value.startsWith("//")) {
    return null;
  }
  return value;
}

export async function createTask(
  _prev: TaskActionState,
  formData: FormData,
): Promise<TaskActionState> {
  const parsed = parseTaskForm(formData);
  if (!parsed.success) {
    const fieldErrors = parsed.error.flatten().fieldErrors;
    return {
      error: firstIssueMessage(fieldErrors) ?? "Invalid task details",
      fieldErrors,
    };
  }

  const { supabase, user, error: authError } = await requireUser();
  if (authError || !user) {
    return { error: authError ?? "You must be signed in." };
  }

  const courseError = await assertOwnedCourse(
    supabase,
    user.id,
    parsed.data.course_id,
    { requireActive: true },
  );
  if (courseError) {
    return { error: courseError };
  }

  const { data, error } = await supabase
    .from("tasks")
    .insert({
      user_id: user.id,
      course_id: parsed.data.course_id,
      title: parsed.data.title,
      description: parsed.data.description,
      deadline: parsed.data.deadline,
      status: parsed.data.status,
      estimated_duration: parsed.data.estimated_duration,
    })
    .select("id")
    .maybeSingle();

  if (error) {
    return { error: error.message };
  }
  if (!data) {
    return { error: "Could not create task." };
  }

  revalidateTaskPaths(data.id, parsed.data.course_id);
  const returnTo = safeReturnPath(formData.get("return_to"));
  redirect(returnTo ?? `/tasks/${data.id}`);
}

export async function updateTask(
  _prev: TaskActionState,
  formData: FormData,
): Promise<TaskActionState> {
  const id = formData.get("id");
  if (typeof id !== "string" || id.length === 0) {
    return { error: "Task id is required." };
  }

  const parsed = parseTaskForm(formData);
  if (!parsed.success) {
    const fieldErrors = parsed.error.flatten().fieldErrors;
    return {
      error: firstIssueMessage(fieldErrors) ?? "Invalid task details",
      fieldErrors,
    };
  }

  const { supabase, user, error: authError } = await requireUser();
  if (authError || !user) {
    return { error: authError ?? "You must be signed in." };
  }

  const courseError = await assertOwnedCourse(
    supabase,
    user.id,
    parsed.data.course_id,
    { requireActive: false },
  );
  if (courseError) {
    return { error: courseError };
  }

  const { data, error } = await supabase
    .from("tasks")
    .update({
      course_id: parsed.data.course_id,
      title: parsed.data.title,
      description: parsed.data.description,
      deadline: parsed.data.deadline,
      status: parsed.data.status,
      estimated_duration: parsed.data.estimated_duration,
      updated_at: new Date().toISOString(),
    })
    .eq("id", id)
    .eq("user_id", user.id)
    .is("deleted_at", null)
    .select("id, course_id")
    .maybeSingle();

  if (error) {
    return { error: error.message };
  }
  if (!data) {
    return { error: "Task not found." };
  }

  revalidateTaskPaths(id, data.course_id);
  return {};
}

export async function completeTask(
  _prev: TaskActionState,
  formData: FormData,
): Promise<TaskActionState> {
  const id = formData.get("id");
  if (typeof id !== "string" || id.length === 0) {
    return { error: "Task id is required." };
  }

  const { supabase, user, error: authError } = await requireUser();
  if (authError || !user) {
    return { error: authError ?? "You must be signed in." };
  }

  const { data, error } = await supabase
    .from("tasks")
    .update({
      status: "done",
      updated_at: new Date().toISOString(),
    })
    .eq("id", id)
    .eq("user_id", user.id)
    .is("deleted_at", null)
    .neq("status", "done")
    .select("id, course_id")
    .maybeSingle();

  if (error) {
    return { error: error.message };
  }
  if (!data) {
    return { error: "Task not found or already completed." };
  }

  revalidateTaskPaths(id, data.course_id);
  return {};
}

export async function softDeleteTask(
  _prev: TaskActionState,
  formData: FormData,
): Promise<TaskActionState> {
  const id = formData.get("id");
  if (typeof id !== "string" || id.length === 0) {
    return { error: "Task id is required." };
  }

  const { supabase, user, error: authError } = await requireUser();
  if (authError || !user) {
    return { error: authError ?? "You must be signed in." };
  }

  const { data, error } = await supabase
    .from("tasks")
    .update({
      deleted_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq("id", id)
    .eq("user_id", user.id)
    .is("deleted_at", null)
    .select("id, course_id")
    .maybeSingle();

  if (error) {
    return { error: error.message };
  }
  if (!data) {
    return { error: "Task not found." };
  }

  revalidateTaskPaths(id, data.course_id);
  redirect("/tasks");
}

export async function addReminderThreshold(
  _prev: TaskActionState,
  formData: FormData,
): Promise<TaskActionState> {
  const taskId = formData.get("task_id");
  if (typeof taskId !== "string" || taskId.length === 0) {
    return { error: "Task id is required." };
  }

  const parsed = reminderThresholdSchema.safeParse({
    days_before: formData.get("days_before"),
  });
  if (!parsed.success) {
    const fieldErrors = parsed.error.flatten().fieldErrors;
    return {
      error: firstIssueMessage(fieldErrors) ?? "Invalid threshold",
      fieldErrors,
    };
  }

  const { supabase, user, error: authError } = await requireUser();
  if (authError || !user) {
    return { error: authError ?? "You must be signed in." };
  }

  const taskError = await assertOwnedActiveTask(supabase, user.id, taskId);
  if (taskError) {
    return { error: taskError };
  }

  const { error } = await supabase.from("reminder_thresholds").insert({
    task_id: taskId,
    days_before: parsed.data.days_before,
    is_default: false,
  });

  if (error) {
    if (isUniqueViolation(error)) {
      return {
        error:
          "A threshold with that days-before value already exists on this task.",
        fieldErrors: {
          days_before: [
            "A threshold with that days-before value already exists on this task.",
          ],
        },
      };
    }
    return { error: error.message };
  }

  revalidateTaskPaths(taskId);
  return {};
}

export async function updateReminderThreshold(
  _prev: TaskActionState,
  formData: FormData,
): Promise<TaskActionState> {
  const id = formData.get("id");
  const taskId = formData.get("task_id");
  if (typeof id !== "string" || id.length === 0) {
    return { error: "Threshold id is required." };
  }
  if (typeof taskId !== "string" || taskId.length === 0) {
    return { error: "Task id is required." };
  }

  const parsed = reminderThresholdSchema.safeParse({
    days_before: formData.get("days_before"),
  });
  if (!parsed.success) {
    const fieldErrors = parsed.error.flatten().fieldErrors;
    return {
      error: firstIssueMessage(fieldErrors) ?? "Invalid threshold",
      fieldErrors,
    };
  }

  const { supabase, user, error: authError } = await requireUser();
  if (authError || !user) {
    return { error: authError ?? "You must be signed in." };
  }

  const taskError = await assertOwnedActiveTask(supabase, user.id, taskId);
  if (taskError) {
    return { error: taskError };
  }

  const { data: existing, error: existingError } = await supabase
    .from("reminder_thresholds")
    .select("id, days_before")
    .eq("id", id)
    .eq("task_id", taskId)
    .maybeSingle();

  if (existingError) {
    return { error: existingError.message };
  }
  if (!existing) {
    return { error: "Threshold not found." };
  }

  if (existing.days_before === parsed.data.days_before) {
    revalidateTaskPaths(taskId);
    return {};
  }

  // Changing days_before customizes the threshold; clear is_default.
  const { data, error } = await supabase
    .from("reminder_thresholds")
    .update({
      days_before: parsed.data.days_before,
      is_default: false,
    })
    .eq("id", id)
    .eq("task_id", taskId)
    .select("id")
    .maybeSingle();

  if (error) {
    if (isUniqueViolation(error)) {
      return {
        error:
          "A threshold with that days-before value already exists on this task.",
        fieldErrors: {
          days_before: [
            "A threshold with that days-before value already exists on this task.",
          ],
        },
      };
    }
    return { error: error.message };
  }
  if (!data) {
    return { error: "Threshold not found." };
  }

  revalidateTaskPaths(taskId);
  return {};
}

export async function removeReminderThreshold(
  _prev: TaskActionState,
  formData: FormData,
): Promise<TaskActionState> {
  const id = formData.get("id");
  const taskId = formData.get("task_id");
  if (typeof id !== "string" || id.length === 0) {
    return { error: "Threshold id is required." };
  }
  if (typeof taskId !== "string" || taskId.length === 0) {
    return { error: "Task id is required." };
  }

  const { supabase, user, error: authError } = await requireUser();
  if (authError || !user) {
    return { error: authError ?? "You must be signed in." };
  }

  const taskError = await assertOwnedActiveTask(supabase, user.id, taskId);
  if (taskError) {
    return { error: taskError };
  }

  const { data, error } = await supabase
    .from("reminder_thresholds")
    .delete()
    .eq("id", id)
    .eq("task_id", taskId)
    .select("id")
    .maybeSingle();

  if (error) {
    return { error: error.message };
  }
  if (!data) {
    return { error: "Threshold not found." };
  }

  revalidateTaskPaths(taskId);
  return {};
}
