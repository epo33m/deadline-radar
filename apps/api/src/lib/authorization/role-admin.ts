import { and, desc, eq, lt, or } from "drizzle-orm";
import {
  authAuditEvents,
  profiles,
  roles,
  userRoles,
} from "@deadline-radar/db";

import { getDb } from "../db";
import { isRoleSlug, type RoleSlug } from "./roles";
import { recordRoleChange } from "./audit";
import { invalidateAuthzCache } from "./cache";
import {
  decodeCursor,
  encodeCursor,
  type CursorPayload,
} from "../api/pagination";

export type RoleMutationResult =
  | { ok: true; roleSlug: RoleSlug; userId: string }
  | { ok: false; error: "invalid_role" | "user_not_found" | "already_assigned" | "not_assigned" };

export async function assignRole(input: {
  actorId: string;
  targetUserId: string;
  roleSlug: string;
  request?: Request;
}): Promise<RoleMutationResult> {
  if (!isRoleSlug(input.roleSlug)) {
    return { ok: false, error: "invalid_role" };
  }

  const db = getDb();
  const result = await db.transaction(async (tx) => {
    const [target] = await tx
      .select({ id: profiles.id })
      .from(profiles)
      .where(eq(profiles.id, input.targetUserId))
      .limit(1);
    if (!target) {
      return { ok: false as const, error: "user_not_found" as const };
    }

    const [role] = await tx
      .select()
      .from(roles)
      .where(eq(roles.slug, input.roleSlug))
      .limit(1);
    if (!role) {
      return { ok: false as const, error: "invalid_role" as const };
    }

    const [inserted] = await tx
      .insert(userRoles)
      .values({
        userId: input.targetUserId,
        roleId: role.id,
        assignedBy: input.actorId,
      })
      .onConflictDoNothing({
        target: [userRoles.userId, userRoles.roleId],
      })
      .returning({ id: userRoles.id });

    if (!inserted) {
      return { ok: false as const, error: "already_assigned" as const };
    }

    await recordRoleChange(
      {
        event: "role.assigned",
        actorId: input.actorId,
        targetUserId: input.targetUserId,
        roleSlug: input.roleSlug,
        request: input.request,
      },
      tx,
    );

    return {
      ok: true as const,
      roleSlug: input.roleSlug as RoleSlug,
      userId: input.targetUserId,
    };
  });

  if (result.ok) {
    invalidateAuthzCache(input.targetUserId);
  }

  return result;
}

export async function revokeRole(input: {
  actorId: string;
  targetUserId: string;
  roleSlug: string;
  request?: Request;
}): Promise<RoleMutationResult> {
  if (!isRoleSlug(input.roleSlug)) {
    return { ok: false, error: "invalid_role" };
  }

  const db = getDb();
  const result = await db.transaction(async (tx) => {
    const [role] = await tx
      .select()
      .from(roles)
      .where(eq(roles.slug, input.roleSlug))
      .limit(1);
    if (!role) {
      return { ok: false as const, error: "invalid_role" as const };
    }

    const [removed] = await tx
      .delete(userRoles)
      .where(
        and(
          eq(userRoles.userId, input.targetUserId),
          eq(userRoles.roleId, role.id),
        ),
      )
      .returning({ id: userRoles.id });

    if (!removed) {
      return { ok: false as const, error: "not_assigned" as const };
    }

    await recordRoleChange(
      {
        event: "role.revoked",
        actorId: input.actorId,
        targetUserId: input.targetUserId,
        roleSlug: input.roleSlug,
        request: input.request,
      },
      tx,
    );

    return {
      ok: true as const,
      roleSlug: input.roleSlug as RoleSlug,
      userId: input.targetUserId,
    };
  });

  if (result.ok) {
    invalidateAuthzCache(input.targetUserId);
  }

  return result;
}

export async function listAuditEvents(options: {
  limit: number;
  cursor?: string;
}): Promise<{
  events: Array<{
    id: string;
    event: string;
    userId: string | null;
    sessionId: string | null;
    result: string;
    method: string | null;
    ip: string | null;
    requestId: string | null;
    metadata: Record<string, unknown> | null;
    createdAt: Date;
  }>;
  nextCursor: string | null;
}> {
  const safeLimit = Math.min(Math.max(options.limit, 1), 100);
  const decoded: CursorPayload | null = options.cursor
    ? decodeCursor(options.cursor)
    : null;

  const rows = await getDb()
    .select({
      id: authAuditEvents.id,
      event: authAuditEvents.event,
      userId: authAuditEvents.userId,
      sessionId: authAuditEvents.sessionId,
      result: authAuditEvents.result,
      method: authAuditEvents.method,
      ip: authAuditEvents.ip,
      requestId: authAuditEvents.requestId,
      metadata: authAuditEvents.metadata,
      createdAt: authAuditEvents.createdAt,
    })
    .from(authAuditEvents)
    .where(
      decoded
        ? or(
            lt(authAuditEvents.createdAt, new Date(decoded.k)),
            and(
              eq(authAuditEvents.createdAt, new Date(decoded.k)),
              lt(authAuditEvents.id, decoded.id),
            ),
          )
        : undefined,
    )
    .orderBy(desc(authAuditEvents.createdAt), desc(authAuditEvents.id))
    .limit(safeLimit + 1);

  const pageRows = rows.slice(0, safeLimit);
  const last = pageRows[pageRows.length - 1];
  const nextCursor =
    rows.length > safeLimit && last
      ? encodeCursor({
          v: 1,
          k: new Date(last.createdAt).toISOString(),
          id: last.id,
        })
      : null;

  return { events: pageRows, nextCursor };
}
