"use server";

import { revalidatePath } from "next/cache";

import { apiJson } from "@/lib/api/server";

export type AttachmentActionState = {
  error?: string;
  fieldErrors?: Partial<Record<string, string[]>>;
};

function revalidateTask(taskId: string) {
  revalidatePath("/tasks");
  revalidatePath(`/tasks/${taskId}`);
}

export async function addLinkAttachment(
  _prev: AttachmentActionState,
  formData: FormData,
): Promise<AttachmentActionState> {
  const taskId = formData.get("task_id");
  if (typeof taskId !== "string" || !taskId) {
    return { error: "Task id is required." };
  }
  const result = await apiJson("/api/attachments/link", {
    method: "POST",
    body: JSON.stringify({
      task_id: taskId,
      name: formData.get("name"),
      url: formData.get("url"),
    }),
  });
  if (result.error) {
    return { error: result.error, fieldErrors: result.fieldErrors };
  }
  revalidateTask(taskId);
  return {};
}

export async function addFileAttachment(
  _prev: AttachmentActionState,
  formData: FormData,
): Promise<AttachmentActionState> {
  const taskId = formData.get("task_id");
  if (typeof taskId !== "string" || !taskId) {
    return { error: "Task id is required." };
  }
  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) {
    return { error: "File is required." };
  }

  const body = new FormData();
  body.set("task_id", taskId);
  const name = formData.get("name");
  if (typeof name === "string" && name.trim()) body.set("name", name);
  body.set("file", file);

  const result = await apiJson("/api/attachments/file", {
    method: "POST",
    body,
  });
  if (result.error) {
    return { error: result.error, fieldErrors: result.fieldErrors };
  }
  revalidateTask(taskId);
  return {};
}

export async function removeAttachment(
  _prev: AttachmentActionState,
  formData: FormData,
): Promise<AttachmentActionState> {
  const id = formData.get("id");
  const taskId = formData.get("task_id");
  if (typeof id !== "string" || !id) {
    return { error: "Attachment id is required." };
  }
  const result = await apiJson(`/api/attachments/${id}`, { method: "DELETE" });
  if (result.error) {
    return { error: result.error, fieldErrors: result.fieldErrors };
  }
  if (typeof taskId === "string") revalidateTask(taskId);
  return {};
}

export async function getAttachmentSignedUrl(
  storagePath: string,
): Promise<{ url?: string; error?: string }> {
  const result = await apiJson<{ url?: string }>(
    `/api/attachments/signed-url?storage_path=${encodeURIComponent(storagePath)}`,
  );
  if (result.error) return { error: result.error };
  return { url: result.url };
}
