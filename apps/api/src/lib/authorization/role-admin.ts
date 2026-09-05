import { and, desc, eq } from "drizzle-orm";
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
  const [target] = await db
    .select({ id: profiles.id })
    .from(profiles)
    .where(eq(profiles.id, input.targetUserId))
    .limit(1);
  if (!target) {
    return { ok: false, error: "user_not_found" };
  }

  const [role] = await db
    .select()
    .from(roles)
    .where(eq(roles.slug, input.roleSlug))
    .limit(1);
  if (!role) {
    return { ok: false, error: "invalid_role" };
  }

  const [existing] = await db
    .select({ id: userRoles.id })
    .from(userRoles)
    .where(
      and(
        eq(userRoles.userId, input.targetUserId),
        eq(userRoles.roleId, role.id),
      ),
    )
    .limit(1);
  if (existing) {
    return { ok: false, error: "already_assigned" };
  }

  await db.insert(userRoles).values({
    userId: input.targetUserId,
    roleId: role.id,
    assignedBy: input.actorId,
  });

  invalidateAuthzCache(input.targetUserId);

  await recordRoleChange({
    event: "role.assigned",
    actorId: input.actorId,
    targetUserId: input.targetUserId,
    roleSlug: input.roleSlug,
    request: input.request,
  });

  return { ok: true, roleSlug: input.roleSlug, userId: input.targetUserId };
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
  const [role] = await db
    .select()
    .from(roles)
    .where(eq(roles.slug, input.roleSlug))
    .limit(1);
  if (!role) {
    return { ok: false, error: "invalid_role" };
  }

  const [removed] = await db
    .delete(userRoles)
    .where(
      and(
        eq(userRoles.userId, input.targetUserId),
        eq(userRoles.roleId, role.id),
      ),
    )
    .returning({ id: userRoles.id });

  if (!removed) {
    return { ok: false, error: "not_assigned" };
  }

  invalidateAuthzCache(input.targetUserId);

  await recordRoleChange({
    event: "role.revoked",
    actorId: input.actorId,
    targetUserId: input.targetUserId,
    roleSlug: input.roleSlug,
    request: input.request,
  });

  return { ok: true, roleSlug: input.roleSlug, userId: input.targetUserId };
}

export async function listAuditEvents(limit: number) {
  const safeLimit = Math.min(Math.max(limit, 1), 200);
  return getDb()
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
    .orderBy(desc(authAuditEvents.createdAt))
    .limit(safeLimit);
}
