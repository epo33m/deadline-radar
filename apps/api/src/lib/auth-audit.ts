import { authAuditEvents } from "@deadline-radar/db";

import { getDb } from "./db";

export type AuthAuditResult = "success" | "failure" | "denied";

export type AuthAuditInput = {
  event: string;
  result: AuthAuditResult;
  userId?: string | null;
  sessionId?: string | null;
  method?: string | null;
  request?: Request;
  requestId?: string | null;
  metadata?: Record<string, unknown>;
};

function clientIp(request: Request | undefined): string | null {
  if (!request) return null;
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0]?.trim() || null;
  return request.headers.get("x-real-ip");
}

function truncate(value: string | null | undefined, max: number): string | null {
  if (!value) return null;
  return value.length > max ? value.slice(0, max) : value;
}

/**
 * Record a security-sensitive auth event. Never logs secrets.
 * Failures to persist must not break the auth request path.
 */
export async function recordAuthEvent(input: AuthAuditInput): Promise<void> {
  const ip = truncate(clientIp(input.request), 64);
  const userAgent = truncate(input.request?.headers.get("user-agent"), 256);
  const requestId =
    input.requestId ??
    input.request?.headers.get("x-request-id") ??
    input.request?.headers.get("x-correlation-id") ??
    null;

  const line = {
    event: input.event,
    result: input.result,
    userId: input.userId ?? null,
    sessionId: input.sessionId ?? null,
    method: input.method ?? null,
    ip,
    requestId,
  };

  console.info("[auth-audit]", JSON.stringify(line));

  try {
    await getDb().insert(authAuditEvents).values({
      event: input.event,
      userId: input.userId ?? null,
      sessionId: input.sessionId ?? null,
      result: input.result,
      method: input.method ?? null,
      ip,
      userAgent,
      requestId,
      metadata: input.metadata ?? null,
    });
  } catch (error) {
    console.error(
      "[auth-audit] persist failed",
      error instanceof Error ? error.message : "unknown",
    );
  }
}
