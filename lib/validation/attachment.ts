import { z } from "zod";

export const attachmentTypeSchema = z.enum(["file", "link"]);

const attachmentNameSchema = z
  .string()
  .trim()
  .min(1, "Attachment name is required");

const absoluteUrlSchema = z.url({
  protocol: /^https?$/,
  hostname: z.regexes.domain,
  error: "URL must be a valid absolute http(s) address",
});

function emptyToUndefined(value: unknown): unknown {
  if (value === undefined || value === null) return undefined;
  if (typeof value === "string" && value.trim().length === 0) return undefined;
  return value;
}

export const linkAttachmentSchema = z
  .object({
    name: attachmentNameSchema,
    url: absoluteUrlSchema,
    storage_path: z.preprocess(emptyToUndefined, z.undefined()).optional(),
  })
  .transform((value) => ({
    type: "link" as const,
    name: value.name,
    url: value.url,
    storage_path: null,
  }));

export const fileAttachmentSchema = z
  .object({
    name: attachmentNameSchema,
    storage_path: z
      .string()
      .trim()
      .min(1, "Storage path is required"),
    url: z.preprocess(emptyToUndefined, z.undefined()).optional(),
  })
  .transform((value) => ({
    type: "file" as const,
    name: value.name,
    storage_path: value.storage_path,
    url: null,
  }));

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
 * `attachments/{user_id}/{task_id}/{filename}`
 */
export function buildAttachmentStoragePath(
  userId: string,
  taskId: string,
  filename: string,
): string {
  const safeName = sanitizeAttachmentFilename(filename);
  return `attachments/${userId}/${taskId}/${safeName}`;
}

/** Object key inside the private `attachments` bucket (no bucket prefix). */
export function attachmentObjectKey(storagePath: string): string {
  const prefix = "attachments/";
  if (storagePath.startsWith(prefix)) {
    return storagePath.slice(prefix.length);
  }
  return storagePath;
}
