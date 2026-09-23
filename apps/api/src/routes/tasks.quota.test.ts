/**
 * SEC-003 regression tests: creation-time quotas bound the email-cost blast
 * radius. Route-level behavior through `app.handle` with mocked provider
 * layers (same strategy as `ownership-mutation.test.ts`):
 *
 * - POST /api/v1/tasks at 200 active tasks → 429, no insert.
 * - POST /api/v1/tasks below quota → 200.
 * - POST /api/v1/tasks/:id/thresholds at 10 thresholds → 429.
 * - PUT /api/v1/tasks/:id/thresholds with 11 offsets → 429.
 */
process.env.NODE_ENV = "test";
process.env.AUTH_BRIDGE_SECRET ??= "test-auth-bridge-secret";
import { beforeEach, describe, expect, mock, test } from "bun:test";

import {
  createAuthorizationContext,
  setLoadAuthorizationContextOverride,
  setOwnershipOverrides,
  type Capability,
} from "../lib/authorization";
import { setVerifyAccessTokenOverride } from "../lib/auth-tokens";

const USER_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const COURSE_A = "11111111-1111-4111-8111-111111111111";
const TASK_A = "22222222-2222-4222-8222-222222222222";

// ---------------------------------------------------------------------------
// Recording mock DB (mirrors ownership-mutation.test.ts).
// ---------------------------------------------------------------------------
let selectResultQueue: unknown[][] = [];
let updateResultRows: unknown[] = [{ id: "row" }];

function chain(op: "select" | "insert" | "update" | "delete") {
  const self = {
    from: () => self,
    innerJoin: () => self,
    leftJoin: () => self,
    orderBy: () => self,
    set: () => self,
    values: () => self,
    where: () => self,
    onConflictDoNothing: () => self,
    limit: async () => selectResultQueue.shift() ?? [],
    returning: async () => updateResultRows,
    then: (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) =>
      Promise.resolve(updateResultRows).then(resolve, reject),
  };
  return self;
}

mock.module("../lib/auth-audit", () => ({
  recordAuthEvent: async () => undefined,
}));

mock.module("../lib/db", () => ({
  getDb: () => {
    const db = {
      select: () => chain("select"),
      insert: () => chain("insert"),
      update: () => chain("update"),
      delete: () => chain("delete"),
      // withUserRls single-tx handlers (P2-3): GUC setup is a no-op here.
      execute: async () => [],
      transaction: (cb: (tx: unknown) => unknown) => cb(db),
    };
    return db;
  },
}));

mock.module("../lib/supabase", () => ({
  createAnonClient: () => ({ auth: {} }),
  createUserClient: () => ({ auth: {} }),
  createServiceClient: () => ({
    storage: { from: () => ({}) },
  }),
}));

const { resetRateLimitBuckets } = await import("../plugins/rate-limit");
const { app } = await import("../app");

function authedAs(capabilities: Capability[]) {
  setVerifyAccessTokenOverride(async (t) => {
    if (t === "user-a")
      return { id: USER_A, email: "a@example.com", sessionId: "sa" };
    return null;
  });
  setLoadAuthorizationContextOverride(async (subject) =>
    createAuthorizationContext({
      subject,
      roles: ["user"],
      capabilities,
    }),
  );
}

const COURSE_ROW = {
  id: COURSE_A,
  userId: USER_A,
  name: "Physics",
  code: null,
  color: "#ffffff",
  icon: null,
  description: null,
  deletedAt: null,
  createdAt: new Date(),
  updatedAt: new Date(),
};

const TASK_ROW = {
  id: TASK_A,
  userId: USER_A,
  courseId: COURSE_A,
  title: "Task",
  description: null,
  deadline: new Date(Date.now() + 30 * 86_400_000),
  status: "todo" as const,
  completedAt: null,
  deletedAt: null,
  createdAt: new Date(),
  updatedAt: new Date(),
  deadlineUpdatedAt: new Date(),
};

function fullTaskRow() {
  return { ...TASK_ROW, deadline: new Date(TASK_ROW.deadline) };
}

describe("SEC-003 — creation-time quotas", () => {
  beforeEach(() => {
    resetRateLimitBuckets();
    selectResultQueue = [];
    updateResultRows = [{ id: "row" }];
    setVerifyAccessTokenOverride(null);
    setLoadAuthorizationContextOverride(null);
    setOwnershipOverrides(null);
  });

  test("POST /tasks at 200 active tasks → 429", async () => {
    authedAs(["task.create"]);
    setOwnershipOverrides({
      ownedCourse: async (userId, courseId) =>
        userId === USER_A && courseId === COURSE_A ? { ...COURSE_ROW } : null,
    });
    // Only select in flow: the quota count (ownership is stubbed).
    selectResultQueue = [[{ value: 200 }]];

    const response = await app.handle(
      new Request("http://localhost/api/v1/tasks", {
        method: "POST",
        headers: {
          authorization: "Bearer user-a",
          "content-type": "application/json",
        },
        body: JSON.stringify({
          title: "One too many",
          course_id: COURSE_A,
          deadline: new Date(Date.now() + 86_400_000).toISOString(),
          status: "todo",
        }),
      }),
    );
    expect(response.status).toBe(429);
    const body = (await response.json()) as { error?: { message?: string } };
    expect(body.error?.message ?? "").toContain("Task limit");
  });

  test("POST /tasks below quota → 200", async () => {
    authedAs(["task.create"]);
    setOwnershipOverrides({
      ownedCourse: async (userId, courseId) =>
        userId === USER_A && courseId === COURSE_A ? { ...COURSE_ROW } : null,
    });
    selectResultQueue = [[{ value: 3 }]];
    updateResultRows = [fullTaskRow()];

    const response = await app.handle(
      new Request("http://localhost/api/v1/tasks", {
        method: "POST",
        headers: {
          authorization: "Bearer user-a",
          "content-type": "application/json",
        },
        body: JSON.stringify({
          title: "Within quota",
          course_id: COURSE_A,
          deadline: new Date(Date.now() + 86_400_000).toISOString(),
          status: "todo",
        }),
      }),
    );
    expect(response.status).toBe(200);
  });

  test("POST /tasks/:id/thresholds at 10 thresholds → 429", async () => {
    authedAs(["threshold.manage"]);
    setOwnershipOverrides({
      ownedTask: async (userId, taskId) =>
        userId === USER_A && taskId === TASK_A ? { ...TASK_ROW } : null,
    });
    // days_before=1 is a default offset → no profile lookup; only the
    // quota count select runs.
    selectResultQueue = [[{ value: 10 }]];

    const response = await app.handle(
      new Request(`http://localhost/api/v1/tasks/${TASK_A}/thresholds`, {
        method: "POST",
        headers: {
          authorization: "Bearer user-a",
          "content-type": "application/json",
        },
        body: JSON.stringify({ days_before: 1 }),
      }),
    );
    expect(response.status).toBe(429);
    const body = (await response.json()) as { error?: { message?: string } };
    expect(body.error?.message ?? "").toContain("Reminder limit");
  });

  test("PUT /tasks/:id/thresholds with 11 offsets → 429", async () => {
    authedAs(["threshold.manage"]);
    setOwnershipOverrides({
      ownedTask: async (userId, taskId) =>
        userId === USER_A && taskId === TASK_A ? { ...TASK_ROW } : null,
    });

    const response = await app.handle(
      new Request(`http://localhost/api/v1/tasks/${TASK_A}/thresholds`, {
        method: "PUT",
        headers: {
          authorization: "Bearer user-a",
          "content-type": "application/json",
        },
        body: JSON.stringify({
          thresholds: Array.from({ length: 11 }, (_, i) => ({
            days_before: i,
          })),
        }),
      }),
    );
    expect(response.status).toBe(429);
  });
});
