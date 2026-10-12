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
  authzGenerationToken,
  getFreshAuthz,
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
 * Invalidation is generation-ordered (#161): a read that began before a
 * revocation committed can never write its pre-revoke snapshot back.
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

  // #161: the generation token is captured BEFORE the database read, so a
  // revocation that commits while this read is in flight can be detected
  // before the result is written back. It also gates the cache lookup, so a
  // snapshot invalidated on another replica is not served for its remaining TTL.
  const generationAtReadStart = await authzGenerationToken(subject.id);

  const cached = await getFreshAuthz(subject.id, generationAtReadStart);
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

    // Do not reinstate an entry that was invalidated while this read was in
    // flight (#161). Skipping the write costs one extra database read on the
    // next request, which is the correct trade for a revocation that must not
    // be reversible by the capability it removes.
    if ((await authzGenerationToken(subject.id)) === generationAtReadStart) {
      setCachedAuthz(
        subject.id,
        {
          roles: validRoles,
          capabilities: [...capabilitySet],
        },
        generationAtReadStart,
      );
    }

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
