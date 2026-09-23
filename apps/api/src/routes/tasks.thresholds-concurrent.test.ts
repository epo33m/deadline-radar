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
const TASK_A = "11111111-1111-4111-8111-111111111111";
const TASK_B = "22222222-2222-4222-8222-222222222222";
const COURSE_A = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

type StoredThreshold = {
  id: string;
  taskId: string;
  daysBefore: number;
  isDefault: boolean;
  createdAt: Date;
  /** RF-09: absent/null = live, Date = archived. */
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

// Simulate Postgres row-level lock per taskId
const taskRowLocks = new Map<string, Promise<void>>();

async function acquireTaskRowLock(taskId: string): Promise<() => void> {
  while (taskRowLocks.has(taskId)) {
    await taskRowLocks.get(taskId);
  }
  let releaseLock: () => void = () => {};
  const lockPromise = new Promise<void>((resolve) => {
    releaseLock = resolve;
  });
  taskRowLocks.set(taskId, lockPromise);

  return () => {
    taskRowLocks.delete(taskId);
    releaseLock();
  };
}

mock.module("../lib/db", () => ({
  getDb: () => {
    return {
      select: () => ({
        from: () => ({
          where: () => ({
            limit: async () => [{ timezone: "UTC" }],
          }),
        }),
      }),
      transaction: async <T>(callback: (tx: any) => Promise<T>): Promise<T> => {
        let releaseLock: () => void = () => {};
        let lockedTaskId: string | null = null;

        const txHandler = {
          // withUserRls GUC setup (P2-3): no-op in the fake. Serialization
          // still comes from SELECT ... FOR UPDATE below.
          execute: async () => [],
          select: () => ({
            from: () => ({
              where: (predicate: any) => ({
                for: (mode: string) => ({
                  limit: async () => {
                    if (mode === "update") {
                      // Simulated SELECT ... FOR UPDATE acquires row lock on parent task
                      releaseLock = await acquireTaskRowLock(TASK_A);
                      lockedTaskId = TASK_A;
                    }
                    return tasksStore.filter((t) => t.deletedAt === null);
                  },
                }),
                limit: async () => tasksStore.filter((t) => t.deletedAt === null),
                orderBy: async () =>
                  thresholdsStore
                    .filter((t) => !t.deletedAt)
                    .sort((a, b) => a.daysBefore - b.daysBefore),
                then: (resolve: (v: unknown) => unknown) =>
                  Promise.resolve(
                    thresholdsStore
                      .filter((t) => !t.deletedAt)
                      .sort((a, b) => a.daysBefore - b.daysBefore),
                  ).then(resolve),
              }),
            }),
          }),
          // RF-09: PUT archives removed offsets (UPDATE deleted_at).
          update: () => ({
            set: (payload: Record<string, unknown>) => ({
              where: (clause: any) => {
                const ids = collectStrings(clause);
                const apply = () => {
                  const updated: StoredThreshold[] = [];
                  thresholdsStore = thresholdsStore.map((item) => {
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
                const idsToDelete = new Set<string>();
                if (clause?.queryChunks) {
                  for (const chunk of clause.queryChunks) {
                    if (Array.isArray(chunk)) {
                      for (const item of chunk) {
                        if (item?.value) idsToDelete.add(String(item.value));
                      }
                    }
                  }
                }
                if (idsToDelete.size > 0) {
                  thresholdsStore = thresholdsStore.filter(
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
                for (const item of items) {
                  thresholdsStore.push({
                    id: `th-${item.daysBefore}`,
                    taskId: item.taskId,
                    daysBefore: item.daysBefore,
                    isDefault: item.isDefault,
                    createdAt: new Date(),
                  });
                }
                return Promise.resolve([]).then(resolve);
              },
            }),
          }),
        };

        try {
          const res = await callback(txHandler as any);
          return res;
        } finally {
          if (releaseLock) {
            releaseLock();
          }
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

describe("M-10 Concurrent PUT /api/v1/tasks/:id/thresholds Serialization", () => {
  beforeEach(() => {
    resetRateLimitBuckets();
    taskRowLocks.clear();
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
      {
        id: TASK_B,
        userId: USER_A,
        courseId: COURSE_A,
        title: "User A Task 2",
        deadline: new Date(Date.now() + 100 * 86400000),
        status: "todo",
        deletedAt: null,
      },
    ];
    // Start with default thresholds [7, 3]
    thresholdsStore = [
      { id: "th-7", taskId: TASK_A, daysBefore: 7, isDefault: true, createdAt: new Date() },
      { id: "th-3", taskId: TASK_A, daysBefore: 3, isDefault: true, createdAt: new Date() },
    ];

    setVerifyAccessTokenOverride(async () => ({
      id: USER_A,
      email: "a@example.com",
      sessionId: "sa",
    }));

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

  test("concurrent requests against the same task are serialized with no partial merges or duplicates", async () => {
    const reqA = app.handle(
      new Request(`http://localhost/api/v1/tasks/${TASK_A}/thresholds`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer user-a",
        },
        body: JSON.stringify({
          thresholds: [{ days_before: 1 }, { days_before: 3 }, { days_before: 7 }],
        }),
      }),
    );

    const reqB = app.handle(
      new Request(`http://localhost/api/v1/tasks/${TASK_A}/thresholds`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer user-a",
        },
        body: JSON.stringify({
          thresholds: [{ days_before: 0 }, { days_before: 7 }],
        }),
      }),
    );

    const [resA, resB] = await Promise.all([reqA, reqB]);

    expect(resA.status).toBe(200);
    expect(resB.status).toBe(200);

    const finalOffsets = thresholdsStore
      .filter((t) => !t.deletedAt)
      .map((t) => t.daysBefore)
      .sort((a, b) => a - b);

    // Concurrency guarantee:
    // Final state MUST be either exactly [1, 3, 7] OR [0, 7].
    // It MUST NEVER be a partial merge like [0, 1, 3, 7] or have duplicate items.
    const isExactStateA = JSON.stringify(finalOffsets) === JSON.stringify([1, 3, 7]);
    const isExactStateB = JSON.stringify(finalOffsets) === JSON.stringify([0, 7]);

    expect(isExactStateA || isExactStateB).toBe(true);

    // Verify no duplicates
    const uniqueOffsets = new Set(finalOffsets);
    expect(uniqueOffsets.size).toBe(finalOffsets.length);
  });
});
