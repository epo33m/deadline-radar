"use server";

import { revalidatePath } from "next/cache";

import { createClient } from "@/lib/supabase/server";
import {
  attachmentObjectKey,
  buildAttachmentStoragePath,
  fileAttachmentSchema,
  linkAttachmentSchema,
} from "@/lib/validation/attachment";

export type AttachmentActionState = {
  error?: string;
  fieldErrors?: Partial<Record<string, string[]>>;
};

const ATTACHMENTS_BUCKET = "attachments";

function firstIssueMessage(
  fieldErrors: Partial<Record<string, string[]>> | undefined,
): string | undefined {
  if (!fieldErrors) return undefined;
  for (const messages of Object.values(fieldErrors)) {
    if (messages?.[0]) return messages[0];
  }
  return undefined;
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

function revalidateTaskPaths(taskId: string) {
  revalidatePath("/tasks");
  revalidatePath(`/tasks/${taskId}`);
}

export async function addLinkAttachment(
  _prev: AttachmentActionState,
  formData: FormData,
): Promise<AttachmentActionState> {
  const taskId = formData.get("task_id");
  if (typeof taskId !== "string" || taskId.length === 0) {
    return { error: "Task id is required." };
  }

  const parsed = linkAttachmentSchema.safeParse({
    name: formData.get("name"),
    url: formData.get("url"),
    storage_path: formData.get("storage_path") ?? undefined,
  });
  if (!parsed.success) {
    const fieldErrors = parsed.error.flatten().fieldErrors;
    return {
      error: firstIssueMessage(fieldErrors) ?? "Invalid link attachment",
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

  const { error } = await supabase.from("attachments").insert({
    task_id: taskId,
    type: parsed.data.type,
    name: parsed.data.name,
    url: parsed.data.url,
    storage_path: null,
  });

  if (error) {
    return { error: error.message };
  }

  revalidateTaskPaths(taskId);
  return {};
}

export async function addFileAttachment(
  _prev: AttachmentActionState,
  formData: FormData,
): Promise<AttachmentActionState> {
  const taskId = formData.get("task_id");
  if (typeof taskId !== "string" || taskId.length === 0) {
    return { error: "Task id is required." };
  }

  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) {
    return {
      error: "Choose a file to upload.",
      fieldErrors: { file: ["Choose a file to upload."] },
    };
  }

  const displayNameRaw = formData.get("name");
  const displayName =
    typeof displayNameRaw === "string" && displayNameRaw.trim().length > 0
      ? displayNameRaw.trim()
      : file.name;

  const { supabase, user, error: authError } = await requireUser();
  if (authError || !user) {
    return { error: authError ?? "You must be signed in." };
  }

  const taskError = await assertOwnedActiveTask(supabase, user.id, taskId);
  if (taskError) {
    return { error: taskError };
  }

  const storagePath = buildAttachmentStoragePath(user.id, taskId, file.name);
  const parsed = fileAttachmentSchema.safeParse({
    name: displayName,
    storage_path: storagePath,
    url: formData.get("url") ?? undefined,
  });
  if (!parsed.success) {
    const fieldErrors = parsed.error.flatten().fieldErrors;
    return {
      error: firstIssueMessage(fieldErrors) ?? "Invalid file attachment",
      fieldErrors,
    };
  }

  const objectKey = attachmentObjectKey(parsed.data.storage_path);
  const { error: uploadError } = await supabase.storage
    .from(ATTACHMENTS_BUCKET)
    .upload(objectKey, file, {
      upsert: false,
      contentType: file.type || undefined,
    });

  if (uploadError) {
    return { error: uploadError.message };
  }

  const { error: insertError } = await supabase.from("attachments").insert({
    task_id: taskId,
    type: parsed.data.type,
    name: parsed.data.name,
    storage_path: parsed.data.storage_path,
    url: null,
  });

  if (insertError) {
    await supabase.storage.from(ATTACHMENTS_BUCKET).remove([objectKey]);
    return { error: insertError.message };
  }

  revalidateTaskPaths(taskId);
  return {};
}

export async function removeAttachment(
  _prev: AttachmentActionState,
  formData: FormData,
): Promise<AttachmentActionState> {
  const id = formData.get("id");
  const taskId = formData.get("task_id");
  if (typeof id !== "string" || id.length === 0) {
    return { error: "Attachment id is required." };
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

  const { data: existing, error: existingError } = await supabase
    .from("attachments")
    .select("id, type, storage_path")
    .eq("id", id)
    .eq("task_id", taskId)
    .maybeSingle();

  if (existingError) {
    return { error: existingError.message };
  }
  if (!existing) {
    return { error: "Attachment not found." };
  }

  const { data, error } = await supabase
    .from("attachments")
    .delete()
    .eq("id", id)
    .eq("task_id", taskId)
    .select("id")
    .maybeSingle();

  if (error) {
    return { error: error.message };
  }
  if (!data) {
    return { error: "Attachment not found." };
  }

  if (existing.type === "file" && existing.storage_path) {
    const objectKey = attachmentObjectKey(existing.storage_path);
    await supabase.storage.from(ATTACHMENTS_BUCKET).remove([objectKey]);
  }

  revalidateTaskPaths(taskId);
  return {};
}

/** Create a short-lived signed URL for a private file attachment. */
export async function getAttachmentSignedUrl(
  storagePath: string,
): Promise<{ url?: string; error?: string }> {
  const { supabase, user, error: authError } = await requireUser();
  if (authError || !user) {
    return { error: authError ?? "You must be signed in." };
  }

  if (!storagePath.startsWith(`attachments/${user.id}/`)) {
    return { error: "Attachment not found." };
  }

  const objectKey = attachmentObjectKey(storagePath);
  const { data, error } = await supabase.storage
    .from(ATTACHMENTS_BUCKET)
    .createSignedUrl(objectKey, 60 * 10);

  if (error || !data?.signedUrl) {
    return { error: error?.message ?? "Could not create download link." };
  }

  return { url: data.signedUrl };
}
