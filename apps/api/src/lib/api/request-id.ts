import { Elysia } from "elysia";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function normalizeRequestId(raw: string | null): string {
  if (raw && UUID_RE.test(raw.trim()) && raw.trim().length <= 128) {
    return raw.trim();
  }
  return crypto.randomUUID();
}

export function extractClientRequestId(request: Request): string | null {
  return (
    request.headers.get("x-request-id") ??
    request.headers.get("x-correlation-id")
  );
}

/**
 * Assigns a safe requestId to every request and echoes X-Request-Id.
 * Does not blindly trust arbitrary client IDs (non-UUID → server-generated).
 */
export const requestIdPlugin = new Elysia({ name: "request-id" }).derive(
  { as: "global" },
  ({ request, set }) => {
    const requestId = normalizeRequestId(extractClientRequestId(request));
    set.headers["X-Request-Id"] = requestId;
    return { requestId };
  },
);
