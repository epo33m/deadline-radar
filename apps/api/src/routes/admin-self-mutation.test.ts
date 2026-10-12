/**
 * #161 (route level): the escalation the issue describes ends at the HTTP sink,
 * not merely in the cache.
 *
 * The unit test proves the cache is not resurrected. This one drives real HTTP
 * through the real `app.ts`, auth plugin, guard and admin routes, using the
 * repo's own test seams (`setVerifyAccessTokenOverride`,
 * `setLoadAuthorizationContextOverride`) — so it asserts what an authenticated
 * caller can actually reach, including the status codes.
 *
 * Both self-mutation directions are covered because either alone would leave
 * the revocation reversible.
 */
process.env.NODE_ENV = "test";
process.env.AUTH_BRIDGE_SECRET ??= "test-auth-bridge-secret";

import { beforeEach, describe, expect, mock, test } from "bun:test";
import { idempotencyKeys, profiles, roles, userRoles } from "@deadline-radar/db";

import { resetRateLimitBuckets } from "../plugins/rate-limit";
import { setVerifyAccessTokenOverride } from "../lib/auth-tokens";
import {
  createAuthorizationContext,
  setLoadAuthorizationContextOverride,
} from "../lib/authorization";
import { ADMIN_CAPABILITIES, DOMAIN_CAPABILITIES } from "../lib/authorization/capabilities";
import { resetAuthzCache } from "../lib/authorization/cache";

const ADMIN = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const TARGET = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

let userRolesStore: Array<{ id: string; userId: string; roleId: string }> = [];
let auditEventsStore: Array<{ event: string; userId: string | null }> = [];

const ROLE_ADMIN = { id: "role-admin", slug: "admin" };
const ROLE_USER = { id: "role-user", slug: "user" };

function makeSelectChain(rows: () => Promise<unknown[]>) {
  const chain: Record<string, unknown> = {};
  chain.from = () => chain;
  chain.innerJoin = () => chain;
  chain.where = () => chain;
  chain.limit = () => chain;
  chain.then = (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) =>
    rows().then(resolve, reject);
  return chain;
}

mock.module("../lib/db", () => {
  const tx = {
    select: () => ({
      from: (table: unknown) => {
        if (table === roles) return makeSelectChain(async () => [ROLE_ADMIN, ROLE_USER]);
        if (table === profiles)
          return makeSelectChain(async () => [{ id: TARGET, email: "t@example.com" }]);
        if (table === idempotencyKeys) return makeSelectChain(async () => []);
        return makeSelectChain(async () => []);
      },
    }),
    insert: () => ({
      values: (values: any) => {
        const chain: Record<string, unknown> = {};
        chain.onConflictDoNothing = () => chain;
        chain.returning = async () => {
          const exists = userRolesStore.some(
            (ur) => ur.userId === values.userId && ur.roleId === values.roleId,
          );
          if (exists) return [];
          userRolesStore.push({
            id: `ur-${userRolesStore.length + 1}`,
            userId: values.userId,
            roleId: values.roleId,
          });
          return [{ id: `ur-${userRolesStore.length}` }];
        };
        chain.then = async (
          resolve: (v: unknown) => unknown,
          reject?: (e: unknown) => unknown,
        ) => {
          if (values.event === "role.assigned" || values.event === "role.revoked") {
            auditEventsStore.push({
              event: values.event,
              userId: values.actorId ?? null,
            });
          }
          return resolve([{ id: "audit-1" }]);
        };
        return chain;
      },
    }),
    delete: () => ({
      where: () => ({
        returning: async () => {
          const removed = userRolesStore.filter((ur) => ur.userId === TARGET);
          userRolesStore = userRolesStore.filter((ur) => ur.userId !== TARGET);
          return removed.length > 0 ? [{ id: removed[0].id }] : [];
        },
      }),
    }),
  };

  const db = {
    select: () => ({
      from: () => makeSelectChain(async () => []),
    }),
    // The auth-audit sink writes outside the role transaction; keep it a
    // no-op sink rather than a missing method so denials stay observable.
    insert: () => ({
      values: () => makeSelectChain(async () => [{ id: "audit-denial" }]),
    }),
    transaction: async <T>(callback: (t: any) => Promise<T>): Promise<T> => callback(tx),
  };

  return { getDb: () => db };
});

const { resetRedisClient } = await import("../lib/redis");
const { app } = await import("../app");

/** Capabilities the given token's principal is currently granted. */
const capsByToken: Record<string, string[]> = {
  admin: [...DOMAIN_CAPABILITIES, ...ADMIN_CAPABILITIES],
  revoked: [...DOMAIN_CAPABILITIES],
};

function post(path: string, token: string, body: unknown): Promise<Response> {
  return app.handle(
    new Request(`http://localhost${path}`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify(body),
    }),
  );
}

beforeEach(() => {
  resetRateLimitBuckets();
  resetAuthzCache();
  resetRedisClient();
  userRolesStore = [
    { id: "ur-1", userId: TARGET, roleId: ROLE_ADMIN.id },
    { id: "ur-2", userId: TARGET, roleId: ROLE_USER.id },
  ];
  auditEventsStore = [];

  setVerifyAccessTokenOverride(async (token: string) => {
    if (token === "admin") return { id: ADMIN, email: "admin@example.com", sessionId: "sa" };
    if (token === "revoked") return { id: TARGET, email: "target@example.com", sessionId: "st" };
    return null;
  });

  setLoadAuthorizationContextOverride(async (subject: any) =>
    createAuthorizationContext({
      subject,
      roles: subject.id === ADMIN ? ["user", "admin"] : ["user"],
      capabilities: (capsByToken[subject.id === ADMIN ? "admin" : "revoked"] ??
        []) as never,
    }),
  );
});

describe("#161 — self-assignment is refused at the HTTP sink", () => {
  test("an admin cannot grant admin to itself", async () => {
    const response = await post("/api/v1/admin/roles/assign", "admin", {
      user_id: ADMIN,
      role_slug: "admin",
    });

    expect(response.status).toBe(400);
    const body = (await response.json()) as { error?: { message?: string } };
    expect(body.error?.message).toContain("Cannot assign a role to yourself");

    // Nothing was written.
    expect(userRolesStore.some((ur) => ur.userId === ADMIN)).toBe(false);
    expect(auditEventsStore).toHaveLength(0);
  });

  test("an admin can still assign a role to another user", async () => {
    const response = await post("/api/v1/admin/roles/assign", "admin", {
      user_id: TARGET,
      role_slug: "user",
    });

    // Guard passed; the outcome past it is the mock's business, never 403.
    expect(response.status).not.toBe(403);
    const body = (await response.json()) as { error?: { message?: string } };
    expect(body.error?.message).not.toContain("Cannot assign a role to yourself");
  });
});

describe("#161 — self-revocation is refused at the HTTP sink", () => {
  test("an admin cannot revoke its own admin role", async () => {
    const response = await post("/api/v1/admin/roles/revoke", "admin", {
      user_id: ADMIN,
      role_slug: "admin",
    });

    expect(response.status).toBe(400);
    const body = (await response.json()) as { error?: { message?: string } };
    expect(body.error?.message).toContain("Cannot revoke your own role");
    expect(auditEventsStore).toHaveLength(0);
  });

  test("an admin can still revoke another user's role", async () => {
    const response = await post("/api/v1/admin/roles/revoke", "admin", {
      user_id: TARGET,
      role_slug: "admin",
    });

    expect(response.status).toBe(200);
    expect(userRolesStore.some((ur) => ur.roleId === ROLE_ADMIN.id)).toBe(false);
    expect(auditEventsStore.some((e) => e.event === "role.revoked")).toBe(true);
  });
});

describe("#161 — a revoked principal cannot re-grant itself through the API", () => {
  test("after revocation the principal gets 403, and 400 even if it held the capability", async () => {
    // Control: the revoked principal holds no admin capability at all.
    const denied = await post("/api/v1/admin/roles/assign", "revoked", {
      user_id: TARGET,
      role_slug: "admin",
    });
    expect(denied.status).toBe(403);

    // The escalation the issue describes: the racing request briefly still
    // holds role.assign. Even then, self-assignment is refused and the admin
    // row stays gone.
    // Revoke first, so "the admin row is absent" is a real post-condition
    // rather than an artifact of the seed.
    const revoked = await post("/api/v1/admin/roles/revoke", "admin", {
      user_id: TARGET,
      role_slug: "admin",
    });
    expect(revoked.status).toBe(200);
    expect(userRolesStore.some((ur) => ur.userId === TARGET && ur.roleId === ROLE_ADMIN.id)).toBe(
      false,
    );

    capsByToken.revoked = [...DOMAIN_CAPABILITIES, ...ADMIN_CAPABILITIES];
    const regrant = await post("/api/v1/admin/roles/assign", "revoked", {
      user_id: TARGET,
      role_slug: "admin",
    });

    expect(regrant.status).toBe(400);
    const body = (await regrant.json()) as { error?: { message?: string } };
    expect(body.error?.message).toContain("Cannot assign a role to yourself");
    // Durable, not a cache window: the admin row was not re-inserted.
    expect(userRolesStore.some((ur) => ur.userId === TARGET && ur.roleId === ROLE_ADMIN.id)).toBe(
      false,
    );
  });
});