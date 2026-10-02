process.env.NODE_ENV = "test";
process.env.AUTH_BRIDGE_SECRET ??= "test-auth-bridge-secret";
import { beforeEach, describe, expect, mock, test } from "bun:test";

import { resetRateLimitBuckets } from "../plugins/rate-limit";
import { setVerifyAccessTokenOverride } from "../lib/auth-tokens";
import {
  createAuthorizationContext,
  setLoadAuthorizationContextOverride,
  setOwnershipOverrides,
  type Capability,
} from "../lib/authorization";
import { DOMAIN_CAPABILITIES } from "../lib/authorization/capabilities";

const USER_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const USER_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const TASK_A = "11111111-1111-4111-8111-111111111111";
const TASK_B = "22222222-2222-4222-8222-222222222222";
const COURSE_A = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

type StoredThreshold = {
  id: string;
  taskId: string;
  daysBefore: number;
  isDefault: boolean;
  createdAt: Date;
  /** RF-09: absent/null = live, Date = archived (removal soft-deletes). */
  deletedAt?: Date | null;
};

/** Collect string params from a drizzle condition tree (id lists / eq ids). */
function collectStrings(cond: any): Set<string> {
  const found = new Set<string>();
  const walk = (node: any): void => {
    if (!node || typeof node !== "object") return;
    if (Array.isArray(node)) {
      for (const item of node) walk(item);
      return;
    }
    if (typeof node.value === "string") found.add(node.value);
    if (Array.isArray(node.queryChunks)) {
      for (const chunk of node.queryChunks) walk(chunk);
    }
  };
  walk(cond);
  return found;
}

type StoredTask = {
  id: string;
  userId: string;
  courseId: string;
  title: string;
  deadline: Date;
  status: "todo" | "in_progress" | "done";
  deletedAt: Date | null;
};

let tasksStore: StoredTask[] = [];
let thresholdsStore: StoredThreshold[] = [];
let shouldFailInsideTx = false;
// I-07 spy: profile (timezone) SELECTs issued outside the write tx.
let profileSelectCalls = 0;

mock.module("../lib/db", () => ({
  getDb: () => {
    return {
      select: () => ({
        from: () => ({
          where: () => ({
            limit: async () => {
              profileSelectCalls += 1;
              return [{ timezone: "UTC" }];
            },
          }),
        }),
      }),
      transaction: async <T>(callback: (tx: any) => Promise<T>): Promise<T> => {
        const snapshot = thresholdsStore.map((t) => ({ ...t }));
        let currentList = thresholdsStore.map((t) => ({ ...t }));
        const live = () => currentList.filter((t) => !t.deletedAt);

        const txHandler = {
          // withUserRls GUC setup (P2-3): no-op in the fake.
          execute: async () => [],
          select: () => ({
            from: () => ({
              where: () => ({
                for: () => ({
                  limit: async () =>
                    tasksStore.filter((t) => t.deletedAt === null),
                }),
                limit: async () =>
                  tasksStore.filter((t) => t.deletedAt === null),
                orderBy: async () =>
                  [...live()].sort((a, b) => a.daysBefore - b.daysBefore),
                then: (resolve: (v: unknown) => unknown) =>
                  Promise.resolve([...live()]).then(resolve),
              }),
            }),
          }),
          // RF-09: PUT archives removed offsets and DELETE archives; both are
          // UPDATE deleted_at, so the fake records the soft-delete.
          update: () => ({
            set: (payload: Record<string, unknown>) => ({
              where: (clause: any) => {
                const ids = collectStrings(clause);
                const apply = (): StoredThreshold[] => {
                  if (shouldFailInsideTx) {
                    throw new Error("SIMULATED_DB_ERROR_INSIDE_TX");
                  }
                  const updated: StoredThreshold[] = [];
                  currentList = currentList.map((item) => {
                    if (ids.has(item.id) && !item.deletedAt) {
                      const next = { ...item, ...payload } as StoredThreshold;
                      updated.push(next);
                      return next;
                    }
                    return item;
                  });
                  return updated;
                };
                return {
                  returning: async () => apply(),
                  then: (resolve: (v: unknown) => unknown) =>
                    Promise.resolve(apply()).then(resolve),
                };
              },
            }),
          }),
          delete: (table: any) => ({
            where: (clause: any) => ({
              then: (resolve: (v: unknown) => unknown) => {
                if (shouldFailInsideTx) {
                  throw new Error("SIMULATED_DB_ERROR_INSIDE_TX");
                }
                const idsToDelete = collectStrings(clause);
                if (idsToDelete.size > 0) {
                  currentList = currentList.filter(
                    (item) => !idsToDelete.has(item.id),
                  );
                }
                return Promise.resolve([]).then(resolve);
              },
            }),
          }),
          insert: () => ({
            values: (items: Array<{ taskId: string; daysBefore: number; isDefault: boolean }>) => ({
              then: (resolve: (v: unknown) => unknown) => {
                if (shouldFailInsideTx) {
                  throw new Error("SIMULATED_DB_ERROR_INSIDE_TX");
                }
                for (const item of items) {
                  currentList.push({
                    id: `th-${item.daysBefore}`,
                    taskId: item.taskId,
                    daysBefore: item.daysBefore,
                    isDefault: item.isDefault,
                    createdAt: new Date(),
                    deletedAt: null,
                  });
                }
                return Promise.resolve([]).then(resolve);
              },
            }),
          }),
        };

        try {
          const res = await callback(txHandler as any);
          thresholdsStore = currentList;
          return res;
        } catch (err) {
          thresholdsStore = snapshot;
          throw err;
        }
      },
    };
  },
}));

mock.module("../lib/supabase", () => ({
  createAnonClient: () => ({ auth: {} }),
  createUserClient: () => ({ auth: {} }),
  createServiceClient: () => ({ auth: {} }),
}));

mock.module("../lib/auth-audit", () => ({
  recordAuthEvent: async () => undefined,
}));

const { app } = await import("../app");

describe("PUT /api/v1/tasks/:id/thresholds — Atomic Bulk Replace", () => {
  beforeEach(() => {
    resetRateLimitBuckets();
    shouldFailInsideTx = false;
    profileSelectCalls = 0;
    tasksStore = [
      {
        id: TASK_A,
        userId: USER_A,
        courseId: COURSE_A,
        title: "User A Task",
        deadline: new Date(Date.now() + 100 * 86400000), // far future
        status: "todo",
        deletedAt: null,
      },
      {
        id: TASK_B,
        userId: USER_B,
        courseId: COURSE_A,
        title: "User B Task",
        deadline: new Date(Date.now() + 100 * 86400000),
        status: "todo",
        deletedAt: null,
      },
    ];
    thresholdsStore = [];

    setVerifyAccessTokenOverride(async (token) => {
      if (token === "user-a") {
        return { id: USER_A, email: "a@example.com", sessionId: "sa" };
      }
      if (token === "user-b") {
        return { id: USER_B, email: "b@example.com", sessionId: "sb" };
      }
      return null;
    });

    setLoadAuthorizationContextOverride(async (subject) =>
      createAuthorizationContext({
        subject,
        roles: ["user"],
        capabilities: [...DOMAIN_CAPABILITIES] as Capability[],
      }),
    );

    setOwnershipOverrides({
      ownedTask: async (userId, taskId) => {
        const found = tasksStore.find(
          (t) => t.id === taskId && t.userId === userId && t.deletedAt === null,
        );
        if (!found) return null;
        return {
          id: found.id,
          userId: found.userId,
          courseId: found.courseId,
          title: found.title,
          description: null,
          deadline: found.deadline,
          status: found.status,
          createdAt: found.deadline,
          updatedAt: found.deadline,
          deadlineUpdatedAt: found.deadline,
          completedAt: null,
          deletedAt: found.deletedAt,
        };
      },
      ownedCourse: async (userId, courseId) => ({
        id: courseId,
        userId,
        name: "Course",
        code: null,
        color: null,
        icon: null,
        description: null,
        createdAt: new Date(0),
        updatedAt: new Date(0),
        deletedAt: null,
      }),
    });
  });

  test("A. Replace empty -> defaults [7, 3, 1, 0]", async () => {
    const res = await app.handle(
      new Request(`http://localhost/api/v1/tasks/${TASK_A}/thresholds`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer user-a",
        },
        body: JSON.stringify({
          thresholds: [
            { days_before: 7 },
            { days_before: 3 },
            { days_before: 1 },
            { days_before: 0 },
          ],
        }),
      }),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { thresholds: Array<{ daysBefore: number }> };
    expect(body.thresholds.map((t) => t.daysBefore)).toEqual([0, 1, 3, 7]);
    expect(thresholdsStore.length).toBe(4);
  });

  test("B. Replace existing -> new set", async () => {
    thresholdsStore = [
      { id: "th-7", taskId: TASK_A, daysBefore: 7, isDefault: true, createdAt: new Date() },
      { id: "th-3", taskId: TASK_A, daysBefore: 3, isDefault: true, createdAt: new Date() },
    ];

    const res = await app.handle(
      new Request(`http://localhost/api/v1/tasks/${TASK_A}/thresholds`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer user-a",
        },
        body: JSON.stringify({
          thresholds: [
            { days_before: 7 },
            { days_before: 3 },
            { days_before: 1 },
            { days_before: 0 },
          ],
        }),
      }),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { thresholds: Array<{ daysBefore: number }> };
    expect(body.thresholds.map((t) => t.daysBefore)).toEqual([0, 1, 3, 7]);
  });

  test("C. Remove thresholds (desired subset)", async () => {
    thresholdsStore = [
      { id: "th-7", taskId: TASK_A, daysBefore: 7, isDefault: true, createdAt: new Date() },
      { id: "th-3", taskId: TASK_A, daysBefore: 3, isDefault: true, createdAt: new Date() },
      { id: "th-1", taskId: TASK_A, daysBefore: 1, isDefault: true, createdAt: new Date() },
    ];

    const res = await app.handle(
      new Request(`http://localhost/api/v1/tasks/${TASK_A}/thresholds`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer user-a",
        },
        body: JSON.stringify({
          thresholds: [{ days_before: 1 }],
        }),
      }),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { thresholds: Array<{ daysBefore: number }> };
    expect(body.thresholds.map((t) => t.daysBefore)).toEqual([1]);
  });

  test("D. Empty set replaces all thresholds", async () => {
    thresholdsStore = [
      { id: "th-7", taskId: TASK_A, daysBefore: 7, isDefault: true, createdAt: new Date() },
    ];

    const res = await app.handle(
      new Request(`http://localhost/api/v1/tasks/${TASK_A}/thresholds`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer user-a",
        },
        body: JSON.stringify({ thresholds: [] }),
      }),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { thresholds: Array<{ daysBefore: number }> };
    expect(body.thresholds).toEqual([]);
  });

  test("E. Idempotent PUT (calling twice produces same result)", async () => {
    const payload = {
      thresholds: [{ days_before: 7 }, { days_before: 1 }],
    };

    const res1 = await app.handle(
      new Request(`http://localhost/api/v1/tasks/${TASK_A}/thresholds`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer user-a",
        },
        body: JSON.stringify(payload),
      }),
    );
    expect(res1.status).toBe(200);

    const res2 = await app.handle(
      new Request(`http://localhost/api/v1/tasks/${TASK_A}/thresholds`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer user-a",
        },
        body: JSON.stringify(payload),
      }),
    );
    expect(res2.status).toBe(200);
    const body2 = (await res2.json()) as { thresholds: Array<{ daysBefore: number }> };
    expect(body2.thresholds.map((t) => t.daysBefore)).toEqual([1, 7]);
  });

  test("F. Validation failure (duplicate offsets, negative values) -> 400, DB unchanged", async () => {
    thresholdsStore = [
      { id: "th-7", taskId: TASK_A, daysBefore: 7, isDefault: true, createdAt: new Date() },
    ];

    // Duplicate offset
    const resDup = await app.handle(
      new Request(`http://localhost/api/v1/tasks/${TASK_A}/thresholds`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer user-a",
        },
        body: JSON.stringify({
          thresholds: [{ days_before: 3 }, { days_before: 3 }],
        }),
      }),
    );
    expect(resDup.status).toBe(400);
    expect(thresholdsStore.map((t) => t.daysBefore)).toEqual([7]); // unchanged

    // Negative offset
    const resNeg = await app.handle(
      new Request(`http://localhost/api/v1/tasks/${TASK_A}/thresholds`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer user-a",
        },
        body: JSON.stringify({
          thresholds: [{ days_before: -5 }],
        }),
      }),
    );
    expect(resNeg.status).toBe(400);
    expect(thresholdsStore.map((t) => t.daysBefore)).toEqual([7]); // unchanged
  });

  test("G. Ownership failure -> 404, DB unchanged", async () => {
    // User A trying to update User B's task
    thresholdsStore = [
      { id: "th-7", taskId: TASK_B, daysBefore: 7, isDefault: true, createdAt: new Date() },
    ];

    const res = await app.handle(
      new Request(`http://localhost/api/v1/tasks/${TASK_B}/thresholds`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer user-a",
        },
        body: JSON.stringify({
          thresholds: [{ days_before: 1 }],
        }),
      }),
    );
    expect(res.status).toBe(404);
    expect(thresholdsStore.map((t) => t.daysBefore)).toEqual([7]); // unchanged
  });

  test("H. Transaction rollback: DB error during transaction rolls back completely", async () => {
    const initialSnapshot = [
      { id: "th-7", taskId: TASK_A, daysBefore: 7, isDefault: true, createdAt: new Date() },
      { id: "th-3", taskId: TASK_A, daysBefore: 3, isDefault: true, createdAt: new Date() },
    ];
    thresholdsStore = [...initialSnapshot];
    shouldFailInsideTx = true;

    const res = await app.handle(
      new Request(`http://localhost/api/v1/tasks/${TASK_A}/thresholds`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer user-a",
        },
        body: JSON.stringify({
          thresholds: [{ days_before: 1 }, { days_before: 0 }],
        }),
      }),
    );
    expect(res.status).toBe(500);
    // Verified: state was restored exactly, no partial delete or insert committed
    expect(thresholdsStore.map((t) => t.daysBefore)).toEqual([7, 3]);
  });
});

describe("RF-09 threshold removal archives (never hard-deletes)", () => {
  beforeEach(() => {
    resetRateLimitBuckets();
    shouldFailInsideTx = false;
    profileSelectCalls = 0;
    tasksStore = [
      {
        id: TASK_A,
        userId: USER_A,
        courseId: COURSE_A,
        title: "User A Task",
        deadline: new Date(Date.now() + 100 * 86400000),
        status: "todo",
        deletedAt: null,
      },
    ];
    thresholdsStore = [];

    setVerifyAccessTokenOverride(async (token) =>
      token === "user-a"
        ? { id: USER_A, email: "a@example.com", sessionId: "sa" }
        : null,
    );
    setLoadAuthorizationContextOverride(async (subject) =>
      createAuthorizationContext({
        subject,
        roles: ["user"],
        capabilities: [...DOMAIN_CAPABILITIES] as Capability[],
      }),
    );
    setOwnershipOverrides({
      ownedTask: async (userId, taskId) =>
        userId === USER_A && taskId === TASK_A
          ? ({
              id: TASK_A,
              userId: USER_A,
              courseId: COURSE_A,
              title: "User A Task",
              description: null,
              deadline: new Date(Date.now() + 100 * 86400000),
              status: "todo",
              createdAt: new Date(),
              updatedAt: new Date(),
              deadlineUpdatedAt: new Date(),
              completedAt: null,
              deletedAt: null,
            } as any)
          : null,
    });
  });

  test("PUT archives the removed offset instead of deleting the row", async () => {
    thresholdsStore = [
      { id: "th-7", taskId: TASK_A, daysBefore: 7, isDefault: true, createdAt: new Date() },
      { id: "th-1", taskId: TASK_A, daysBefore: 1, isDefault: true, createdAt: new Date() },
    ];

    const res = await app.handle(
      new Request(`http://localhost/api/v1/tasks/${TASK_A}/thresholds`, {
        method: "PUT",
        headers: { "Content-Type": "application/json", Authorization: "Bearer user-a" },
        body: JSON.stringify({ thresholds: [{ days_before: 1 }] }),
      }),
    );
    expect(res.status).toBe(200);

    // Row is retained (history survives) but archived.
    const archived = thresholdsStore.find((t) => t.daysBefore === 7);
    expect(archived).toBeDefined();
    expect(archived!.deletedAt).toBeInstanceOf(Date);
  });

  test("re-adding an archived offset creates a fresh live row", async () => {
    thresholdsStore = [
      { id: "th-3-old", taskId: TASK_A, daysBefore: 3, isDefault: true, createdAt: new Date(), deletedAt: new Date() },
    ];

    const res = await app.handle(
      new Request(`http://localhost/api/v1/tasks/${TASK_A}/thresholds`, {
        method: "PUT",
        headers: { "Content-Type": "application/json", Authorization: "Bearer user-a" },
        body: JSON.stringify({ thresholds: [{ days_before: 3 }] }),
      }),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { thresholds: Array<{ daysBefore: number }> };
    expect(body.thresholds.map((t) => t.daysBefore)).toEqual([3]);
    // Old archived row + new live row.
    expect(thresholdsStore.filter((t) => t.daysBefore === 3).length).toBe(2);
    expect(thresholdsStore.filter((t) => t.daysBefore === 3 && !t.deletedAt).length).toBe(1);
  });

  test("I-07: PUT with 3 non-default thresholds issues exactly 1 profile query", async () => {
    const res = await app.handle(
      new Request(`http://localhost/api/v1/tasks/${TASK_A}/thresholds`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer user-a",
        },
        body: JSON.stringify({
          thresholds: [
            { days_before: 5 },
            { days_before: 6 },
            { days_before: 9 },
          ],
        }),
      }),
    );
    expect(res.status).toBe(200);
    expect(profileSelectCalls).toBe(1);
  });

  test("I-07: PUT with all-default offsets skips the profile lookup", async () => {
    const res = await app.handle(
      new Request(`http://localhost/api/v1/tasks/${TASK_A}/thresholds`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer user-a",
        },
        body: JSON.stringify({
          thresholds: [
            { days_before: 7 },
            { days_before: 3 },
            { days_before: 1 },
            { days_before: 0 },
          ],
        }),
      }),
    );
    expect(res.status).toBe(200);
    expect(profileSelectCalls).toBe(0);
  });

  test("DELETE /thresholds/:id archives (row survives with deletedAt)", async () => {
    const thresholdId = "77777777-7777-4777-8777-777777777777";
    thresholdsStore = [
      { id: thresholdId, taskId: TASK_A, daysBefore: 7, isDefault: true, createdAt: new Date() },
    ];

    const res = await app.handle(
      new Request(
        `http://localhost/api/v1/tasks/${TASK_A}/thresholds/${thresholdId}`,
        {
          method: "DELETE",
          headers: { Authorization: "Bearer user-a" },
        },
      ),
    );
    expect(res.status).toBe(200);
    expect(thresholdsStore.length).toBe(1);
    expect(thresholdsStore[0].deletedAt).toBeInstanceOf(Date);
  });
});
