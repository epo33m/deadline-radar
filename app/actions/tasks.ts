"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";
import { taskSchema } from "@/lib/validation/task";

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

function revalidateTaskPaths(taskId?: string) {
  revalidatePath("/tasks");
  if (taskId) {
    revalidatePath(`/tasks/${taskId}`);
  }
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

  revalidateTaskPaths(data.id);
  redirect(`/tasks/${data.id}`);
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
    .select("id")
    .maybeSingle();

  if (error) {
    return { error: error.message };
  }
  if (!data) {
    return { error: "Task not found." };
  }

  revalidateTaskPaths(id);
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
    .select("id")
    .maybeSingle();

  if (error) {
    return { error: error.message };
  }
  if (!data) {
    return { error: "Task not found." };
  }

  revalidatePath("/tasks");
  redirect("/tasks");
}
