import { authAuditEvents } from "@deadline-radar/db";
import { recordAuthEvent } from "../auth-audit";
import { auditClientIp } from "../proxy-trust";
import type { AuthorizationContext } from "./context";
import type { AuthzDenyReason } from "./decide";

function truncate(value: string | null | undefined, max: number): string | null {
  if (!value) return null;
  return value.length > max ? value.slice(0, max) : value;
}

export type AuthAuditTxExecutor = {
  insert: (table: typeof authAuditEvents) => {
    values: (val: typeof authAuditEvents.$inferInsert) => Promise<unknown>;
  };
};

/** Record authorization denials and role admin actions. Never log secrets. */
export async function recordAuthzDenied(input: {
  ctx?: AuthorizationContext | null;
  capability?: string;
  reason: AuthzDenyReason;
  resource?: string;
  resourceId?: string;
  request?: Request;
  /** #142: direct TCP peer; falls back to the per-request memo. */
  peerAddress?: string | null;
}): Promise<void> {
  await recordAuthEvent({
    event: "authz.denied",
    result: "denied",
    userId: input.ctx?.subject.id ?? null,
    sessionId: input.ctx?.subject.sessionId ?? null,
    request: input.request,
    peerAddress: input.peerAddress,
    requestId: input.ctx?.requestId,
    metadata: {
      capability: input.capability ?? null,
      reason: input.reason,
      resource: input.resource ?? null,
      resourceId: input.resourceId ?? null,
      roles: input.ctx?.roles ?? [],
    },
  });
}

export async function recordRoleChange(
  input: {
    event: "role.assigned" | "role.revoked";
    actorId: string;
    targetUserId: string;
    roleSlug: string;
    request?: Request;
    /** #142: direct TCP peer; falls back to the per-request memo. */
    peerAddress?: string | null;
  },
  tx?: AuthAuditTxExecutor,
): Promise<void> {
  if (tx) {
    // #142: same TRUST_PROXY-aware derivation as every other audit row — this
    // in-transaction writer used to read X-Forwarded-For unconditionally.
    const ip = truncate(auditClientIp(input.request, input.peerAddress), 64);
    const userAgent = truncate(input.request?.headers.get("user-agent"), 256);
    const requestId =
      input.request?.headers.get("x-request-id") ??
      input.request?.headers.get("x-correlation-id") ??
      null;

    const line = {
      event: input.event,
      result: "success" as const,
      userId: input.actorId,
      sessionId: null,
      method: null,
      ip,
      requestId,
    };

    console.info("[auth-audit]", JSON.stringify(line));

    await tx.insert(authAuditEvents).values({
      event: input.event,
      userId: input.actorId,
      sessionId: null,
      result: "success",
      method: null,
      ip,
      userAgent,
      requestId,
      metadata: {
        targetUserId: input.targetUserId,
        roleSlug: input.roleSlug,
      },
    });
  } else {
    await recordAuthEvent({
      event: input.event,
      result: "success",
      userId: input.actorId,
      request: input.request,
      peerAddress: input.peerAddress,
      metadata: {
        targetUserId: input.targetUserId,
        roleSlug: input.roleSlug,
      },
    });
  }
}
