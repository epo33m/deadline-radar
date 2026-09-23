import { z } from "zod";

export const attachmentTypeSchema = z.enum(["file", "link"]);

const attachmentNotesSchema = z
  .string()
  .trim()
  .max(1000, "Notes must be at most 1000 characters");

const absoluteUrlSchema = z.url({
  protocol: /^https?$/,
  hostname: z.regexes.domain,
  error: "URL must be a valid absolute http(s) address",
});

/**
 * SEC-006: defense-in-depth for rendering stored link URLs as `<a href>`.
 * Accepts only absolute `http:`/`https:` URLs. The API already enforces this
 * via `absoluteUrlSchema`, but the renderer must not depend on that alone:
 * one loosened schema would turn every stored URL into a scheme-XSS vector.
 * Non-empty trimmed strings that WHATWG-parse to http(s) pass; `javascript:`,
 * `data:`, protocol-relative, relative, and non-string inputs fail.
 */
export function isSafeExternalHttpUrl(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const trimmed = value.trim();
  if (trimmed.length === 0 || trimmed.length > 2000) return false;
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return false;
  }
  return parsed.protocol === "http:" || parsed.protocol === "https:";
}

function emptyToUndefined(value: unknown): unknown {
  if (value === undefined || value === null) return undefined;
  if (typeof value === "string" && value.trim().length === 0) return undefined;
  return value;
}

export const linkAttachmentRequestSchema = z
  .object({
    task_id: z.uuid("Task is required"),
    url: absoluteUrlSchema,
    notes: z.preprocess(emptyToUndefined, attachmentNotesSchema.optional()),
  })
  .strict()
  .transform((value) => ({
    type: "link" as const,
    task_id: value.task_id,
    url: value.url,
    notes: value.notes ?? null,
    storage_path: null as null,
  }));

export const linkAttachmentSchema = z
  .object({
    url: absoluteUrlSchema,
    notes: z.preprocess(emptyToUndefined, attachmentNotesSchema.optional()),
    storage_path: z.preprocess(emptyToUndefined, z.undefined()).optional(),
  })
  .strict()
  .transform((value) => ({
    type: "link" as const,
    url: value.url,
    notes: value.notes ?? null,
    storage_path: null,
  }));

export const fileAttachmentSchema = z
  .object({
    storage_path: z.string().trim().min(1, "Storage path is required"),
    notes: z.preprocess(emptyToUndefined, attachmentNotesSchema.optional()),
    url: z.preprocess(emptyToUndefined, z.undefined()).optional(),
  })
  .strict()
  .transform((value) => ({
    type: "file" as const,
    storage_path: value.storage_path,
    notes: value.notes ?? null,
    url: null,
  }));

export const MAX_ATTACHMENT_BYTES = 10 * 1_048_576;
export const ALLOWED_ATTACHMENT_MIME = [
  "application/pdf",
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
  "text/plain",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
] as const;

export type LinkAttachmentInput = z.infer<typeof linkAttachmentSchema>;
export type FileAttachmentInput = z.infer<typeof fileAttachmentSchema>;
export type AttachmentType = z.infer<typeof attachmentTypeSchema>;

/** Sanitize a user-provided filename to a single path segment. */
export function sanitizeAttachmentFilename(filename: string): string {
  const trimmed = filename.trim();
  const base = trimmed.split(/[/\\]/).filter(Boolean).at(-1) ?? "";
  const cleaned = base.replace(/[^\w.\- ()[\]]+/g, "_").replace(/^\.+/, "");
  return cleaned.length > 0 ? cleaned : "file";
}

/**
 * Storage path convention from ARCHITECTURE.md:
 * `attachments/{user_id}/{task_id}/{attachment_id}/{filename}`
 */
export function buildAttachmentStoragePath(
  userId: string,
  taskId: string,
  attachmentId: string,
  filename: string,
): string {
  const safeName = sanitizeAttachmentFilename(filename);
  return `attachments/${userId}/${taskId}/${attachmentId}/${safeName}`;
}

/** Object key inside the private `attachments` bucket (no bucket prefix). */
export function attachmentObjectKey(storagePath: string): string {
  const prefix = "attachments/";
  if (storagePath.startsWith(prefix)) {
    return storagePath.slice(prefix.length);
  }
  return storagePath;
}
