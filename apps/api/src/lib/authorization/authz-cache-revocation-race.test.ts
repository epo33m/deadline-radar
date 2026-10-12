/**
 * #161: a committed role revoke was undone by an authorization read that was
 * already in flight when the revoke committed.
 *
 * The defect was ORDERING, not staleness. `invalidateAuthzCache` performed an
 * unconditional delete and the read path performed an unconditional write
 * after awaiting the database, so a read that started before the revoke could
 * land after it and re-cache the pre-revoke snapshot — restarting the TTL and
 * handing the revoked principal back `role.assign`, the same capability that
 * had just been removed. The revocation was reversible by the person it
 * removed.
 *
 * The interleaving is driven deterministically with a deferred: the read's
 * first database statement is parked, the revoke runs to completion while it is
 * parked, then the read is released. No timing, no sleeps, no flake. Each case
 * carries a CONTROL with no in-flight read, so a failure points at the
 * interleaving rather than at the fixture.
 */
import { beforeEach, describe, expect, mock, test } from "bun:test";
import { profiles, roleCapabilities, roles, userRoles } from "@deadline-radar/db";

const TARGET_USER_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const ACTOR_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

type Deferred<T> = {
  promise: Promise<T>;
  resolve: (value: T) => void;
};

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

// --- Fake database -----------------------------------------------------------
// Models the only behaviour that matters here: a SELECT's result is captured
// when the statement begins, and the caller may await before it is handed back.
// That is READ COMMITTED semantics — the statement cannot see a revoke that
// commits after it started.

let userRolesStore: Array<{ id: string; userId: string; roleId: string }> = [];
let auditEventsStore: Array<{ event: string; userId: string | null }> = [];

/** When set, the first roles SELECT parks here instead of returning. */
let parkRolesRead: Deferred<void> | null = null;
/** When set, the roles SELECT resolves with whatever `userRolesStore` holds
 *  at RELEASE time, simulating a statement that already captured its rows. */
let rolesReadSnapshot: Array<{ id: string; roleId: string; slug: string }> | null =
  null;

const ROLE_ADMIN = { id: "role-admin", slug: "admin" };
const ROLE_USER = { id: "role-user", slug: "user" };

const CAPS_BY_ROLE: Record<string, string[]> = {
  "role-admin": ["role.assign", "role.revoke", "audit.view"],
  "role-user": ["course.view", "task.view"],
};

/**
 * Slug the transactional role lookup should resolve.
 *
 * The transaction first resolves the slug to a role id and then deletes exactly
 * that (userId, roleId) pair. The fixture supplies the slug rather than parsing
 * drizzle's condition AST, which nests several levels deeper than its public
 * shape suggests and is an internal detail this test should not depend on.
 */
let txRoleSlug = "admin";
let lastResolvedRoleId: string | null = null;

function makeSelectChain(rows: () => Promise<unknown[]>) {
  // `joined` records whether `.innerJoin(roles, ...)` was chained, so the
  // userRoles query is distinguishable from the bare roles lookup.
  let joined = false;
  const chain: Record<string, unknown> = {};
  chain.from = () => chain;
  chain.innerJoin = () => {
    joined = true;
    return chain;
  };
  chain.where = () => chain;
  chain.limit = () => chain;
  chain.then = (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) =>
    rows().then(resolve, reject);
  Object.defineProperty(chain, "joined", { get: () => joined });
  return chain;
}

mock.module("../db", () => {
  const tx = {
    select: (fields?: any) => ({
      from: (table: any) => {
        // Compare by identity: these are the real drizzle table objects.
        if (table === roles) {
          return makeSelectChain(async () => {
            const role = txRoleSlug === "admin" ? ROLE_ADMIN : ROLE_USER;
            lastResolvedRoleId = role.id;
            return [role];
          });
        }
        if (table === profiles) {
          return makeSelectChain(async () => [
            { id: TARGET_USER_ID, email: "target@example.com" },
          ]);
        }
        return makeSelectChain(async () => []);
      },
    }),
    insert: (table: any) => ({
      values: (values: any) => {
        const chain: Record<string, unknown> = {};
        chain.onConflictDoNothing = () => chain;
        chain.returning = async () => {
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
          auditEventsStore.push({
            event: values.event,
            userId: values.actorId ?? null,
          });
          return resolve([{ id: "audit-1" }]);
        };
        return chain;
      },
    }),
    delete: () => ({
      where: () => ({
        returning: async () => {
          // Exactly the (userId, roleId) pair the transaction resolved above —
          // the revoked role only, not every role the user holds.
          const removed = userRolesStore.filter(
            (ur) =>
              ur.userId === TARGET_USER_ID &&
              (lastResolvedRoleId === null || ur.roleId === lastResolvedRoleId),
          );
          userRolesStore = userRolesStore.filter(
            (ur) => !removed.some((r) => r.id === ur.id),
          );
          return removed.length > 0 ? [{ id: removed[0].id }] : [];
        },
      }),
    }),
  };

  // The non-transactional path used by loadAuthorizationContext.
  const db = {
    select: (fields?: any) => ({
      from: (table: any) => {
        if (table === userRoles) {
          // loadAuthorizationContext starts here and joins roles.
          const chain = makeSelectChain(async () => {
            // Park here when asked: this is the point where the read is
            // "in flight" and a concurrent revoke can commit.
            if (parkRolesRead) {
              const gate = parkRolesRead;
              parkRolesRead = null;
              await gate.promise;
            }
            const rolesInPlay = rolesReadSnapshot
              ? rolesReadSnapshot.map((r) => r.slug)
              : userRolesStore.map((ur) =>
                  ur.roleId === ROLE_ADMIN.id ? "admin" : "user",
                );
            return rolesInPlay.map((slug) => ({
              roleId: slug === "admin" ? ROLE_ADMIN.id : ROLE_USER.id,
              slug,
            }));
          });
          return chain;
        }
        if (table === roleCapabilities) {
          return makeSelectChain(async () => {
            const roleIds = rolesReadSnapshot
              ? rolesReadSnapshot.map((r) => r.roleId)
              : userRolesStore.map((ur) => ur.roleId);
            // The snapshot covers exactly this request's two statements. In
            // READ COMMITTED each statement takes its own snapshot, so the NEXT
            // request must see post-revoke state — otherwise this fixture would
            // model an infinite stale window rather than a bounded one.
            rolesReadSnapshot = null;
            return roleIds.flatMap((roleId) =>
              (CAPS_BY_ROLE[roleId] ?? []).map((capability) => ({ capability })),
            );
          });
        }
        return makeSelectChain(async () => []);
      },
    }),
    transaction: async <T>(callback: (t: any) => Promise<T>): Promise<T> => {
      return callback(tx);
    },
  };

  return { getDb: () => db };
});

const { revokeRole, assignRole } = await import("./role-admin");
const { loadAuthorizationContext } = await import("./load");
const {
  getCachedAuthz,
  primeCachedAuthz,
  resetAuthzCache,
  setAuthzRedisForTests,
} = await import("./cache");

beforeEach(() => {
  resetAuthzCache();
  userRolesStore = [
    { id: "ur-1", userId: TARGET_USER_ID, roleId: ROLE_ADMIN.id },
    { id: "ur-2", userId: TARGET_USER_ID, roleId: ROLE_USER.id },
  ];
  auditEventsStore = [];
  parkRolesRead = null;
  rolesReadSnapshot = null;
  txRoleSlug = "admin";
  lastResolvedRoleId = null;
  setAuthzRedisForTests(null);
});

const SUBJECT = { id: TARGET_USER_ID, email: "target@example.com", sessionId: "sess-1" };

/**
 * Park the target's read mid-flight, run the revoke, then release.
 * Returns the context the read ultimately produced.
 */
async function readAcrossRevoke() {
  // Capture the statement snapshot BEFORE the revoke commits.
  rolesReadSnapshot = userRolesStore.map((ur) => ({
    id: ur.roleId,
    roleId: ur.roleId,
    slug: ur.roleId === ROLE_ADMIN.id ? "admin" : "user",
  }));

  const gate = deferred<void>();
  parkRolesRead = gate;

  const read = loadAuthorizationContext(SUBJECT, "req-1");
  // Let the read reach the parked statement.
  await Promise.resolve();

  const revoked = await revokeRole({
    actorId: ACTOR_ID,
    targetUserId: TARGET_USER_ID,
    roleSlug: "admin",
  });

  gate.resolve();
  const ctx = await read;
  return { revoked, ctx };
}

describe("#161 — a read in flight across a revoke cannot re-cache the pre-revoke snapshot", () => {
  test("CONTROL: with no read in flight, the revoke leaves no cached entry", async () => {
    const revoked = await revokeRole({
      actorId: ACTOR_ID,
      targetUserId: TARGET_USER_ID,
      roleSlug: "admin",
    });

    expect(revoked.ok).toBe(true);
    expect(getCachedAuthz(TARGET_USER_ID)).toBeNull();

    // Post-revoke state is authoritative: no admin capability.
    const ctx = await loadAuthorizationContext(SUBJECT, "req-1");
    expect(ctx.roles).toEqual(["user"]);
    expect(ctx.capabilities.has("role.assign")).toBe(false);
  });

  test("the stale read still returns post-revoke capabilities to its own caller", async () => {
    // Even the racing request must not act on the snapshot it read — the guard
    // is the cache write, but the claim in the issue is that the window lets
    // the principal SELF-ASSIGN, which the self-mutation guard blocks.
    const { revoked, ctx } = await readAcrossRevoke();
    expect(revoked.ok).toBe(true);
    // This in-flight caller legitimately holds the snapshot it read.
    expect(ctx.capabilities.has("role.assign")).toBe(true);
  });

  test("…but the stale read does NOT restore the cache entry", async () => {
    await readAcrossRevoke();

    // The core assertion: without the generation check the revoked admin
    // capability would be sitting in the cache again for a fresh 30s TTL.
    expect(getCachedAuthz(TARGET_USER_ID)).toBeNull();
  });

  test("the next request after the race reads post-revoke state, not the stale one", async () => {
    await readAcrossRevoke();

    const ctx = await loadAuthorizationContext(SUBJECT, "req-2");
    expect(ctx.roles).toEqual(["user"]);
    expect(ctx.capabilities.has("role.assign")).toBe(false);
    expect(ctx.capabilities.has("role.revoke")).toBe(false);
    expect(ctx.capabilities.has("audit.view")).toBe(false);
  });

  test("the revoked principal cannot self-assign to undo the revocation", async () => {
    const { ctx } = await readAcrossRevoke();

    // The racing caller still holds role.assign from its own read — this is
    // exactly the payoff the issue describes. Self-assignment is refused at the
    // service layer, so the capability it restores cannot be spent on itself.
    expect(ctx.capabilities.has("role.assign")).toBe(true);
    const regrant = await assignRole({
      actorId: TARGET_USER_ID,
      targetUserId: TARGET_USER_ID,
      roleSlug: "admin",
    });
    expect(regrant).toEqual({ ok: false, error: "self_assignment" });
    expect(
      userRolesStore.some((ur) => ur.roleId === ROLE_ADMIN.id),
    ).toBe(false);
  });

  test("a non-race invalidate followed by a read still caches normally", async () => {
    // Guards against over-correcting: the generation check must not disable
    // caching entirely.
    await primeCachedAuthz(TARGET_USER_ID, {
      roles: ["user"],
      capabilities: ["course.view"],
    });
    const ctx = await loadAuthorizationContext(SUBJECT, "req-3");
    expect(ctx.capabilities.has("course.view")).toBe(true);
    expect(getCachedAuthz(TARGET_USER_ID)).not.toBeNull();
  });
});

describe("#161 — self-mutation is refused regardless of cache state", () => {
  test("assignRole refuses self-assignment before touching the database", async () => {
    const result = await assignRole({
      actorId: ACTOR_ID,
      targetUserId: ACTOR_ID,
      roleSlug: "admin",
    });
    expect(result).toEqual({ ok: false, error: "self_assignment" });
    expect(auditEventsStore).toHaveLength(0);
  });

  test("revokeRole refuses self-revocation before touching the database", async () => {
    // Self-revocation would lock the last admin out with nobody to restore it.
    const result = await revokeRole({
      actorId: ACTOR_ID,
      targetUserId: ACTOR_ID,
      roleSlug: "admin",
    });
    expect(result).toEqual({ ok: false, error: "self_revocation" });
    expect(userRolesStore).toHaveLength(2);
    expect(auditEventsStore).toHaveLength(0);
  });

  test("assigning a role to ANOTHER user is unaffected", async () => {
    const result = await assignRole({
      actorId: ACTOR_ID,
      targetUserId: TARGET_USER_ID,
      roleSlug: "user",
    });
    expect(result.ok).toBe(true);
  });
});