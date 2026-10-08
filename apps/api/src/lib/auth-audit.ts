import { authAuditEvents } from "@deadline-radar/db";

import { getDb } from "./db";
import { auditClientIp } from "./proxy-trust";

export type AuthAuditResult = "success" | "failure" | "denied";

export type AuthAuditInput = {
  event: string;
  result: AuthAuditResult;
  userId?: string | null;
  sessionId?: string | null;
  method?: string | null;
  request?: Request;
  /**
   * Direct TCP peer for `request`. Optional: when omitted the peer recorded by
   * the global `peerAddressPlugin` derive is used, so audit rows honour
   * `TRUST_PROXY` without every call site having to pass the server handle.
   */
  peerAddress?: string | null;
  requestId?: string | null;
  metadata?: Record<string, unknown>;
};

function truncate(value: string | null | undefined, max: number): string | null {
  if (!value) return null;
  return value.length > max ? value.slice(0, max) : value;
}

/**
 * Record a security-sensitive auth event. Never logs secrets.
 * Failures to persist must not break the auth request path.
 */
export async function recordAuthEvent(input: AuthAuditInput): Promise<void> {
  const ip = truncate(auditClientIp(input.request, input.peerAddress), 64);

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
