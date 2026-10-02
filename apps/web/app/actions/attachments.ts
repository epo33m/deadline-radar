"use server";

import { revalidatePath } from "next/cache";

import { apiJson } from "@/lib/api/server";
import {
  deriveFileIdempotencyKey,
  generateIdempotencyKey,
  normalizeIdempotencyKey,
} from "@/lib/api/idempotency";
import { mapWithConcurrency } from "@/lib/concurrency";

export type AttachmentActionState = {
  error?: string;
  fieldErrors?: Partial<Record<string, string[]>>;
};

function revalidateTask(taskId: string) {
  // Attachments are only rendered on the task detail page; the task list and
  // other views are unaffected by attachment mutations.
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
  const idemKey =
    normalizeIdempotencyKey(formData.get("idempotency_key")) ??
    generateIdempotencyKey();

  const result = await apiJson("/api/v1/attachments/link", {
    method: "POST",
    headers: {
      "Idempotency-Key": idemKey,
    },
    body: JSON.stringify({
      task_id: taskId,
      url: formData.get("url"),
      notes: formData.get("notes"),
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
  const pickedFiles = formData
    .getAll("file")
    .filter((entry): entry is File => entry instanceof File && entry.size > 0);
  if (pickedFiles.length === 0) {
    return { error: "File is required." };
  }

  const baseKey =
    normalizeIdempotencyKey(formData.get("idempotency_key")) ??
    generateIdempotencyKey();

  const notes = formData.get("notes");
  // Fan out with a hard bound — NEVER an unbounded Promise.all. The API
  // side is per-file idempotent (deriveFileIdempotencyKey), so parallel
  // retries with the same keys are safe (F-13). Stop-on-first-error is
  // preserved: dispatching halts at the first failure; in-flight uploads
  // settle, and that first error is returned.
  const { results, failureIndex } = await mapWithConcurrency(
    pickedFiles,
    4,
    async (file, i) => {
      const fileKey = deriveFileIdempotencyKey(baseKey, i);
      const body = new FormData();
      body.set("task_id", taskId);
      if (typeof notes === "string" && notes.trim()) body.set("notes", notes);
      body.set("file", file);
      return apiJson("/api/v1/attachments/file", {
        method: "POST",
        headers: {
          "Idempotency-Key": fileKey,
        },
        body,
      });
    },
    (result) => Boolean(result.error),
  );
  if (failureIndex !== undefined) {
    const failed = results[failureIndex];
    return { error: failed.error, fieldErrors: failed.fieldErrors };
  }
  revalidateTask(taskId);
  return {};
}

export async function addAttachment(
  prev: AttachmentActionState,
  formData: FormData,
): Promise<AttachmentActionState> {
  const fileEntries = formData.getAll("file");
  const hasFile = fileEntries.some(
    (entry) => entry instanceof File && entry.size > 0,
  );
  const urlRaw = formData.get("url");
  const hasUrl = typeof urlRaw === "string" && urlRaw.trim() !== "";

  if (hasFile && hasUrl) {
    return { error: "Isi URL atau file saja, jangan keduanya." };
  }
  if (hasFile) {
    return addFileAttachment(prev, formData);
  }
  if (hasUrl) {
    return addLinkAttachment(prev, formData);
  }
  return { error: "URL atau file wajib diisi." };
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
  const result = await apiJson(`/api/v1/attachments/${id}`, { method: "DELETE" });
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
    `/api/v1/attachments/signed-url?storage_path=${encodeURIComponent(storagePath)}`,
  );
  if (result.error) return { error: result.error };
  return { url: result.url };
}
