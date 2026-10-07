import { ApiError } from "./errors";
import { MAX_JSON_BODY_BYTES } from "../../plugins/body-limit";

/**
 * Read the request body as text while counting bytes (#138).
 * Enforces the cap at the byte layer so chunked requests without a
 * `Content-Length` header cannot bypass `bodyLimitPlugin`.
 * Throws `ApiError.payloadTooLarge()` (413 envelope) past `maxBytes`.
 */
export async function readLimitedRequestText(
  request: Request,
  maxBytes: number,
): Promise<string> {
  const body = request.body;
  if (!body) {
    return "";
  }
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) {
        total += value.byteLength;
        if (total > maxBytes) {
          throw ApiError.payloadTooLarge();
        }
        chunks.push(value);
      }
    }
  } finally {
    reader.releaseLock();
  }
  const merged = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(merged);
}

/** Read JSON body without framework schema stripping (enables Zod .strict()). */
export async function readJsonBody(request: Request): Promise<unknown> {
  const text = await readLimitedRequestText(request, MAX_JSON_BODY_BYTES);
  if (!text || text.trim().length === 0) {
    throw ApiError.validation("Request body is required");
  }
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw ApiError.validation("Invalid JSON body");
  }
}
