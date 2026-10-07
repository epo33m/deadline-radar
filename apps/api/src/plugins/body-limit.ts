import { Elysia } from "elysia";

import { ApiError } from "../lib/api/errors";
import { env } from "../env";

/** Default JSON body limit (1 MiB). Multipart uploads use a separate cap. */
export const MAX_JSON_BODY_BYTES = 1_048_576;
export const MAX_UPLOAD_BYTES = 10 * 1_048_576; // 10 MiB
/**
 * Socket-level backstop for `serve.maxRequestBodySize` (#138).
 * Must fit the largest legitimate route (10 MiB file) plus multipart
 * framing/fields, so it carries slack over MAX_UPLOAD_BYTES.
 * Per-route caps stay authoritative; this only bounds total buffering.
 */
export const MAX_REQUEST_BODY_BYTES = 12 * 1_048_576; // 12 MiB

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

export function detectMimeFromBytes(
  buffer: ArrayBuffer | Uint8Array,
): string | null {
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  if (bytes.length === 0) return null;

  // PDF: %PDF (0x25 0x50 0x44 0x46)
  if (
    bytes.length >= 4 &&
    bytes[0] === 0x25 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x44 &&
    bytes[3] === 0x46
  ) {
    return "application/pdf";
  }

  // PNG: 0x89 0x50 0x4E 0x47 0x0D 0x0A 0x1A 0x0A
  if (
    bytes.length >= 8 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47 &&
    bytes[4] === 0x0d &&
    bytes[5] === 0x0a &&
    bytes[6] === 0x1a &&
    bytes[7] === 0x0a
  ) {
    return "image/png";
  }

  // JPEG: 0xFF 0xD8 0xFF
  if (
    bytes.length >= 3 &&
    bytes[0] === 0xff &&
    bytes[1] === 0xd8 &&
    bytes[2] === 0xff
  ) {
    return "image/jpeg";
  }

  // GIF: GIF87a or GIF89a
  if (
    bytes.length >= 6 &&
    bytes[0] === 0x47 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x38 &&
    (bytes[4] === 0x37 || bytes[4] === 0x39) &&
    bytes[5] === 0x61
  ) {
    return "image/gif";
  }

  // WebP: RIFF (bytes 0-3) + WEBP (bytes 8-11)
  if (
    bytes.length >= 12 &&
    bytes[0] === 0x52 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x46 &&
    bytes[8] === 0x57 &&
    bytes[9] === 0x45 &&
    bytes[10] === 0x42 &&
    bytes[11] === 0x50
  ) {
    return "image/webp";
  }

  // DOC (legacy MS Word compound file): 0xD0 0xCF 0x11 0xE0 0xA1 0xB1 0x1A 0xE1
  if (
    bytes.length >= 8 &&
    bytes[0] === 0xd0 &&
    bytes[1] === 0xcf &&
    bytes[2] === 0x11 &&
    bytes[3] === 0xe0 &&
    bytes[4] === 0xa1 &&
    bytes[5] === 0xb1 &&
    bytes[6] === 0x1a &&
    bytes[7] === 0xe1
  ) {
    return "application/msword";
  }

  // DOCX / ZIP: PK\x03\x04
  if (
    bytes.length >= 4 &&
    bytes[0] === 0x50 &&
    bytes[1] === 0x4b &&
    bytes[2] === 0x03 &&
    bytes[3] === 0x04
  ) {
    return "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
  }

  // Plain text (must not contain null bytes in sample)
  const sampleLen = Math.min(bytes.length, 512);
  let isText = true;
  for (let i = 0; i < sampleLen; i++) {
    if (bytes[i] === 0x00) {
      isText = false;
      break;
    }
  }
  if (isText) {
    return "text/plain";
  }

  return null;
}

export function assertAllowedUploadMime(
  mime: string | undefined,
  bytes?: ArrayBuffer | Uint8Array,
): void {
  const normalized = (mime ?? "").split(";")[0]?.trim().toLowerCase() ?? "";
  if (!normalized || !ALLOWED_UPLOAD_MIME.has(normalized)) {
    throw ApiError.validation("Unsupported file type", [
      {
        field: "file",
        message: "File MIME type is not allowed",
      },
    ]);
  }

  if (bytes) {
    const detected = detectMimeFromBytes(bytes);
    if (!detected || detected !== normalized) {
      throw ApiError.validation("Invalid file content", [
        {
          field: "file",
          message:
            "File signature/content does not match the declared MIME type",
        },
      ]);
    }
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
