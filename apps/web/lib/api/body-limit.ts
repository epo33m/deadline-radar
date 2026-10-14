/**
 * Bounded request-body read for the web-tier auth bridges (#167).
 *
 * `register/route.ts` and `login/route.ts` used to call `request.text()`,
 * materialising the entire attacker-supplied body as a string before any
 * size gate applied. The API-side cap (`readLimitedRequestText`) runs
 * downstream, after this tier already buffered everything.
 *
 * Same counting-reader pattern as
 * `apps/api/src/lib/api/read-json.ts:10-43`: stream the body, enforce the
 * cap at the byte layer (chunked requests carry no `Content-Length`), and
 * stop accumulating past the limit. Returns `null` when the body exceeds
 * `maxBytes` so the caller can answer 413 before any upstream fetch.
 */
export const BRIDGE_BODY_MAX_BYTES = 64 * 1024;

export async function readLimitedBodyText(
  request: Request,
  maxBytes: number = BRIDGE_BODY_MAX_BYTES,
): Promise<string | null> {
  const body = request.body;
  if (!body) return "";
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) {
        total += value.byteLength;
        if (total > maxBytes) return null;
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
