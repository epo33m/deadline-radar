import { eq, inArray } from "drizzle-orm";
import { roleCapabilities, roles, userRoles } from "@deadline-radar/db";

import { getDb } from "../db";
import type { AuthUser } from "../auth-tokens";
import { isCapability, type Capability } from "./capabilities";
import {
  createAuthorizationContext,
  type AuthorizationContext,
} from "./context";
import { isRoleSlug, type RoleSlug } from "./roles";
import {
  getCachedAuthz,
  setCachedAuthz,
} from "./cache";

type Db = ReturnType<typeof getDb>;

type LoadFn = (
  subject: AuthUser,
  requestId?: string | null,
) => Promise<AuthorizationContext>;

let loadOverride: LoadFn | null = null;

/** Test-only hook to inject AuthorizationContext without DB. */
export function setLoadAuthorizationContextOverride(fn: LoadFn | null): void {
  loadOverride = fn;
}

/**
 * Load roles and capabilities from the database for a verified subject.
 * Fail closed: DB errors and invalid role slugs yield empty capabilities.
 * Never trusts client-provided roles.
 * Uses a short-lived per-userId cache; invalidated on role assign/revoke.
 */
export async function loadAuthorizationContext(
  subject: AuthUser,
  requestId?: string | null,
  options?: { db?: Db },
): Promise<AuthorizationContext> {
  if (loadOverride) {
    return loadOverride(subject, requestId);
  }

  if (!subject?.id) {
    return createAuthorizationContext({
      subject: subject ?? { id: "", email: undefined, sessionId: undefined },
      roles: [],
      capabilities: [],
      requestId,
    });
  }

  const cached = getCachedAuthz(subject.id);
  if (cached) {
    return createAuthorizationContext({
      subject,
      roles: cached.roles,
      capabilities: cached.capabilities,
      requestId,
    });
  }

  try {
    const db = options?.db ?? getDb();
    const assigned = await db
      .select({
        roleId: roles.id,
        slug: roles.slug,
      })
      .from(userRoles)
      .innerJoin(roles, eq(userRoles.roleId, roles.id))
      .where(eq(userRoles.userId, subject.id));

    const validRoles: RoleSlug[] = [];
    const roleIds: string[] = [];
    for (const row of assigned) {
      if (!isRoleSlug(row.slug)) {
        continue;
      }
      validRoles.push(row.slug);
      roleIds.push(row.roleId);
    }

    const capabilitySet = new Set<Capability>();
    if (roleIds.length > 0) {
      const caps = await db
        .select({ capability: roleCapabilities.capability })
        .from(roleCapabilities)
        .where(inArray(roleCapabilities.roleId, roleIds));

      for (const row of caps) {
        if (isCapability(row.capability)) {
          capabilitySet.add(row.capability);
        }
      }
    }

    setCachedAuthz(subject.id, {
      roles: validRoles,
      capabilities: [...capabilitySet],
    });

    return createAuthorizationContext({
      subject,
      roles: validRoles,
      capabilities: capabilitySet,
      requestId,
    });
  } catch (error) {
    console.error(
      "[authz] failed to load roles — denying",
      error instanceof Error ? error.message : "unknown",
    );
    return createAuthorizationContext({
      subject,
      roles: [],
      capabilities: [],
      requestId,
    });
  }
}
