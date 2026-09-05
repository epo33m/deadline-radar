import { Elysia } from "elysia";

import { ApiError } from "../lib/api/errors";
import { env } from "../env";

/** Default JSON body limit (1 MiB). Multipart uploads use a separate cap. */
export const MAX_JSON_BODY_BYTES = 1_048_576;
export const MAX_UPLOAD_BYTES = 10 * 1_048_576; // 10 MiB

const ALLOWED_UPLOAD_MIME = new Set([
  "application/pdf",
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
  "text/plain",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
]);

export function assertAllowedUploadMime(mime: string | undefined): void {
  const normalized = (mime ?? "").split(";")[0]?.trim().toLowerCase() ?? "";
  if (!normalized || !ALLOWED_UPLOAD_MIME.has(normalized)) {
    throw ApiError.validation("Unsupported file type", [
      {
        field: "file",
        message: "File MIME type is not allowed",
      },
    ]);
  }
}

export function assertUploadSize(size: number): void {
  if (size > MAX_UPLOAD_BYTES) {
    throw ApiError.payloadTooLarge(
      `File exceeds maximum size of ${MAX_UPLOAD_BYTES} bytes`,
    );
  }
}

/**
 * Reject oversized Content-Length early (before expensive handlers).
 * Multipart attachment uploads allow up to MAX_UPLOAD_BYTES.
 */
export const bodyLimitPlugin = new Elysia({ name: "body-limit" }).onBeforeHandle(
  { as: "global" },
  ({ request }) => {
    const pathname = new URL(request.url).pathname;
    if (pathname === "/health" || pathname.startsWith("/openapi")) return;

    const raw = request.headers.get("content-length");
    if (!raw) return;
    const length = Number(raw);
    if (!Number.isFinite(length) || length < 0) {
      throw ApiError.validation("Invalid Content-Length");
    }

    const isUpload =
      pathname.endsWith("/attachments/file") ||
      pathname.includes("/attachments/file");
    const max = isUpload ? MAX_UPLOAD_BYTES : MAX_JSON_BODY_BYTES;
    if (length > max) {
      throw ApiError.payloadTooLarge();
    }
  },
);

export function bodyLimitForEnv(): number {
  return env.isProduction ? MAX_JSON_BODY_BYTES : MAX_JSON_BODY_BYTES;
}
