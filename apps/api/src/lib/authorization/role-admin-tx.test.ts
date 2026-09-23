process.env.NODE_ENV = "test";
process.env.AUTH_BRIDGE_SECRET ??= "test-auth-bridge-secret";
import { beforeEach, describe, expect, mock, test } from "bun:test";

import {
  authAuditEvents,
  profiles,
  roles,
  userRoles,
} from "@deadline-radar/db";

const ACTOR_ID = "11111111-1111-4111-8111-111111111111";
const TARGET_USER_ID = "22222222-2222-4222-8222-222222222222";
const ROLE_ID_USER = "33333333-3333-4333-8333-333333333333";
const ROLE_ID_ADMIN = "44444444-4444-4444-8444-444444444444";

type ProfileRow = { id: string; email: string };
type RoleRow = { id: string; slug: string };
type UserRoleRow = { id: string; userId: string; roleId: string; assignedBy: string | null };
type AuditRow = {
  id: string;
  event: string;
  userId: string | null;
  result: string;
  metadata: Record<string, unknown> | null;
};

let profilesStore: ProfileRow[] = [];
let rolesStore: RoleRow[] = [];
let userRolesStore: UserRoleRow[] = [];
let auditEventsStore: AuditRow[] = [];
let failAuditInsert = false;

import {
  getCachedAuthz,
  resetAuthzCache,
  setCachedAuthz,
} from "./cache";

mock.module("../db", () => ({
  getDb: () => ({
    transaction: async <T>(callback: (tx: any) => Promise<T>): Promise<T> => {
      // Create snapshot for transactional rollback simulation
      const userRolesSnapshot = [...userRolesStore];
      const auditEventsSnapshot = [...auditEventsStore];

      const tx = {
        select: (fields?: any) => ({
          from: (table: any) => ({
            where: (condition: any) => ({
              limit: async () => {
                if (table === profiles || table?._?.name === "profiles") {
                  return profilesStore;
                }
                if (table === roles || table?._?.name === "roles") {
                  const targetSlug =
                    condition?.value ??
                    condition?.right?.value ??
                    (condition?.queryChunks
                      ? condition.queryChunks.find((c: any) => typeof c?.value === "string")?.value
                      : null);
                  if (targetSlug) {
                    return rolesStore.filter((r) => r.slug === targetSlug);
                  }
                  return rolesStore;
                }
                if (table === userRoles || table?._?.name === "user_roles") {
                  return userRolesStore;
                }
                return [];
              },
            }),
          }),
        }),
        insert: (table: any) => ({
          values: (values: any) => ({
            onConflictDoNothing: (config?: any) => ({
              returning: async () => {
                // userRoles insert with onConflictDoNothing
                const exists = userRolesStore.some(
                  (ur) => ur.userId === values.userId && ur.roleId === values.roleId,
                );
                if (exists) {
                  // Conflict - do nothing, return empty array
                  return [];
                }
                const newRow: UserRoleRow = {
                  id: `ur-${Date.now()}-${Math.random()}`,
                  userId: values.userId,
                  roleId: values.roleId,
                  assignedBy: values.assignedBy ?? null,
                };
                userRolesStore.push(newRow);
                return [{ id: newRow.id }];
              },
            }),
            then: async (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) => {
              if (failAuditInsert) {
                const err = new Error("DB Connection Error during audit insert");
                if (reject) return reject(err);
                throw err;
              }
              const auditRow: AuditRow = {
                id: `audit-${Date.now()}-${Math.random()}`,
                event: values.event,
                userId: values.userId ?? null,
                result: values.result,
                metadata: values.metadata ?? null,
              };
              auditEventsStore.push(auditRow);
              return resolve([auditRow]);
            },
          }),
        }),
        delete: (table: any) => ({
          where: (condition: any) => ({
            returning: async () => {
              // userRoles delete
              const initialLen = userRolesStore.length;
              const matching = userRolesStore.filter(
                (ur) => ur.userId === TARGET_USER_ID,
              );
              userRolesStore = userRolesStore.filter(
                (ur) => ur.userId !== TARGET_USER_ID,
              );
              return matching.length > 0 ? [{ id: matching[0].id }] : [];
            },
          }),
        }),
      };

      try {
        const res = await callback(tx);
        return res;
      } catch (err) {
        // Rollback state on error
        userRolesStore = userRolesSnapshot;
        auditEventsStore = auditEventsSnapshot;
        throw err;
      }
    },
  }),
}));

const { assignRole, revokeRole } = await import("./role-admin");

describe("M-11 — Transactional Role Administration", () => {
  beforeEach(() => {
    resetAuthzCache();
    // Prime the cache with existing user data
    setCachedAuthz(TARGET_USER_ID, {
      roles: ["user"],
      capabilities: ["course.view"],
    });
    profilesStore = [{ id: TARGET_USER_ID, email: "target@example.com" }];
    rolesStore = [
      { id: ROLE_ID_USER, slug: "user" },
      { id: ROLE_ID_ADMIN, slug: "admin" },
    ];
    userRolesStore = [];
    auditEventsStore = [];
    failAuditInsert = false;
  });

  describe("assignRole()", () => {
    test("successfully assigns role, writes audit event, and invalidates cache post-commit", async () => {
      const res = await assignRole({
        actorId: ACTOR_ID,
        targetUserId: TARGET_USER_ID,
        roleSlug: "admin",
      });

      expect(res.ok).toBe(true);
      if (res.ok) {
        expect(res.roleSlug).toBe("admin");
        expect(res.userId).toBe(TARGET_USER_ID);
      }

      // Role assignment stored
      expect(userRolesStore.length).toBe(1);
      expect(userRolesStore[0].userId).toBe(TARGET_USER_ID);
      expect(userRolesStore[0].roleId).toBe(ROLE_ID_ADMIN);

      // Audit event stored
      expect(auditEventsStore.length).toBe(1);
      expect(auditEventsStore[0].event).toBe("role.assigned");
      expect(auditEventsStore[0].userId).toBe(ACTOR_ID);
      expect(auditEventsStore[0].metadata?.targetUserId).toBe(TARGET_USER_ID);
      expect(auditEventsStore[0].metadata?.roleSlug).toBe("admin");

      // Cache invalidation triggered post-commit
      expect(getCachedAuthz(TARGET_USER_ID)).toBeNull();
    });

    test("returns user_not_found without creating audit event or invalidating cache", async () => {
      profilesStore = []; // No target user

      const res = await assignRole({
        actorId: ACTOR_ID,
        targetUserId: TARGET_USER_ID,
        roleSlug: "admin",
      });

      expect(res).toEqual({ ok: false, error: "user_not_found" });
      expect(userRolesStore.length).toBe(0);
      expect(auditEventsStore.length).toBe(0);
      // Cache NOT invalidated
      expect(getCachedAuthz(TARGET_USER_ID)).not.toBeNull();
    });

    test("returns invalid_role without touching DB or invalidating cache", async () => {
      const res = await assignRole({
        actorId: ACTOR_ID,
        targetUserId: TARGET_USER_ID,
        roleSlug: "nonexistent_role",
      });

      expect(res).toEqual({ ok: false, error: "invalid_role" });
      expect(userRolesStore.length).toBe(0);
      expect(auditEventsStore.length).toBe(0);
      expect(getCachedAuthz(TARGET_USER_ID)).not.toBeNull();
    });

    test("duplicate assignment returns already_assigned without writing second audit event", async () => {
      // First assignment
      const res1 = await assignRole({
        actorId: ACTOR_ID,
        targetUserId: TARGET_USER_ID,
        roleSlug: "admin",
      });
      expect(res1.ok).toBe(true);
      expect(userRolesStore.length).toBe(1);
      expect(auditEventsStore.length).toBe(1);

      // Reprime cache
      setCachedAuthz(TARGET_USER_ID, {
        roles: ["admin"],
        capabilities: ["role.assign"],
      });

      // Duplicate assignment
      const res2 = await assignRole({
        actorId: ACTOR_ID,
        targetUserId: TARGET_USER_ID,
        roleSlug: "admin",
      });
      expect(res2).toEqual({ ok: false, error: "already_assigned" });

      // No new row and no duplicate audit event
      expect(userRolesStore.length).toBe(1);
      expect(auditEventsStore.length).toBe(1);
      // Cache NOT invalidated on duplicate failure
      expect(getCachedAuthz(TARGET_USER_ID)).not.toBeNull();
    });

    test("concurrent assign race: one succeeds, other gets already_assigned without 500 error", async () => {
      const p1 = assignRole({
        actorId: ACTOR_ID,
        targetUserId: TARGET_USER_ID,
        roleSlug: "admin",
      });
      const p2 = assignRole({
        actorId: ACTOR_ID,
        targetUserId: TARGET_USER_ID,
        roleSlug: "admin",
      });

      const [res1, res2] = await Promise.all([p1, p2]);

      const results = [res1, res2];
      const successCount = results.filter((r) => r.ok).length;
      const alreadyAssignedCount = results.filter(
        (r) => !r.ok && r.error === "already_assigned",
      ).length;

      expect(successCount).toBe(1);
      expect(alreadyAssignedCount).toBe(1);
      expect(userRolesStore.length).toBe(1);
      expect(auditEventsStore.length).toBe(1);
      expect(getCachedAuthz(TARGET_USER_ID)).toBeNull();
    });

    test("audit insertion failure rolls back role assignment completely (atomicity)", async () => {
      failAuditInsert = true;

      await expect(
        assignRole({
          actorId: ACTOR_ID,
          targetUserId: TARGET_USER_ID,
          roleSlug: "admin",
        }),
      ).rejects.toThrow("DB Connection Error during audit insert");

      // Transaction rolled back: role assignment is NOT saved
      expect(userRolesStore.length).toBe(0);
      expect(auditEventsStore.length).toBe(0);
      // Cache must NOT be invalidated if transaction fails
      expect(getCachedAuthz(TARGET_USER_ID)).not.toBeNull();
    });
  });

  describe("revokeRole()", () => {
    beforeEach(() => {
      userRolesStore = [
        {
          id: "ur-1",
          userId: TARGET_USER_ID,
          roleId: ROLE_ID_ADMIN,
          assignedBy: ACTOR_ID,
        },
      ];
      setCachedAuthz(TARGET_USER_ID, {
        roles: ["admin"],
        capabilities: ["role.assign"],
      });
    });

    test("successfully revokes role, writes audit event, and invalidates cache post-commit", async () => {
      const res = await revokeRole({
        actorId: ACTOR_ID,
        targetUserId: TARGET_USER_ID,
        roleSlug: "admin",
      });

      expect(res.ok).toBe(true);
      if (res.ok) {
        expect(res.roleSlug).toBe("admin");
        expect(res.userId).toBe(TARGET_USER_ID);
      }

      // Role removed
      expect(userRolesStore.length).toBe(0);

      // Audit event stored
      expect(auditEventsStore.length).toBe(1);
      expect(auditEventsStore[0].event).toBe("role.revoked");
      expect(auditEventsStore[0].userId).toBe(ACTOR_ID);
      expect(auditEventsStore[0].metadata?.targetUserId).toBe(TARGET_USER_ID);
      expect(auditEventsStore[0].metadata?.roleSlug).toBe("admin");

      // Cache invalidation triggered post-commit
      expect(getCachedAuthz(TARGET_USER_ID)).toBeNull();
    });

    test("returns not_assigned when target user does not have the role", async () => {
      userRolesStore = []; // No roles assigned

      const res = await revokeRole({
        actorId: ACTOR_ID,
        targetUserId: TARGET_USER_ID,
        roleSlug: "admin",
      });

      expect(res).toEqual({ ok: false, error: "not_assigned" });
      expect(auditEventsStore.length).toBe(0);
      expect(getCachedAuthz(TARGET_USER_ID)).not.toBeNull();
    });

    test("returns invalid_role without touching DB or invalidating cache", async () => {
      const res = await revokeRole({
        actorId: ACTOR_ID,
        targetUserId: TARGET_USER_ID,
        roleSlug: "unknown_role",
      });

      expect(res).toEqual({ ok: false, error: "invalid_role" });
      expect(userRolesStore.length).toBe(1);
      expect(auditEventsStore.length).toBe(0);
      expect(getCachedAuthz(TARGET_USER_ID)).not.toBeNull();
    });

    test("audit insertion failure rolls back role revocation completely (atomicity)", async () => {
      failAuditInsert = true;

      await expect(
        revokeRole({
          actorId: ACTOR_ID,
          targetUserId: TARGET_USER_ID,
          roleSlug: "admin",
        }),
      ).rejects.toThrow("DB Connection Error during audit insert");

      // Transaction rolled back: role is still assigned
      expect(userRolesStore.length).toBe(1);
      expect(auditEventsStore.length).toBe(0);
      // Cache must NOT be invalidated if transaction fails
      expect(getCachedAuthz(TARGET_USER_ID)).not.toBeNull();
    });
  });
});
