import { recordAuthEvent } from "../auth-audit";
import type { AuthorizationContext } from "./context";
import type { AuthzDenyReason } from "./decide";

/** Record authorization denials and role admin actions. Never log secrets. */
export async function recordAuthzDenied(input: {
  ctx?: AuthorizationContext | null;
  capability?: string;
  reason: AuthzDenyReason;
  resource?: string;
  resourceId?: string;
  request?: Request;
}): Promise<void> {
  await recordAuthEvent({
    event: "authz.denied",
    result: "denied",
    userId: input.ctx?.subject.id ?? null,
    sessionId: input.ctx?.subject.sessionId ?? null,
    request: input.request,
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

export async function recordRoleChange(input: {
  event: "role.assigned" | "role.revoked";
  actorId: string;
  targetUserId: string;
  roleSlug: string;
  request?: Request;
}): Promise<void> {
  await recordAuthEvent({
    event: input.event,
    result: "success",
    userId: input.actorId,
    request: input.request,
    metadata: {
      targetUserId: input.targetUserId,
      roleSlug: input.roleSlug,
    },
  });
}
