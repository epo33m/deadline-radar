// Terminal Done (DOMAIN.md §2.3, F-02 closed by lifecycle decision):
// - POST may not create a task directly as `done` (400).
// - PATCH on a `done` task is rejected (409), whether it edits metadata or
//   attempts a reopen (`done → todo/in_progress`).
// - Forward transitions still work: PATCH active title (200),
//   PATCH active → done (200), POST /:id/complete idempotent on done (200).
process.env.NODE_ENV = "test";
process.env.AUTH_BRIDGE_SECRET ??= "test-auth-bridge-secret";
import { beforeEach, describe, expect, mock, test } from "bun:test";

import { resetRateLimitBuckets } from "../plugins/rate-limit";
import { setVerifyAccessTokenOverride } from "../lib/auth-tokens";
import {
  createAuthorizationContext,
  setLoadAuthorizationContextOverride,
  setOwnershipOverrides,
} from "../lib/authorization";
import { DOMAIN_CAPABILITIES } from "../lib/authorization/capabilities";

const USER_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const COURSE_A = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const TASK_ACTIVE = "11111111-1111-4111-8111-111111111111";
const TASK_DONE = "22222222-2222-4222-8222-222222222222";

let selectResultQueue: unknown[][] = [];
let updateResultRows: unknown[] = [];

function chain() {
  const self = {
    from: () => self,
    where: () => self,
    set: (payload: Record<string, unknown>) => {
      void payload;
      return self;
    },
    values: () => self,
    limit: async () => selectResultQueue.shift() ?? [],
    returning: async () => updateResultRows,
  };
  return self;
}

mock.module("../lib/db", () => ({
  getDb: () => ({
    select: () => chain(),
    insert: () => chain(),
    update: () => chain(),
    // withUserRls single-tx handlers (P2-3): GUC setup is a no-op here.
    execute: async () => [],
    transaction: (cb: (tx: unknown) => unknown) =>
      cb({
        select: () => chain(),
        insert: () => chain(),
        update: () => chain(),
        execute: async () => [],
      }),
  }),
}));

const { app } = await import("../app");

function baseTaskRow(id: string, status: "todo" | "done") {
  return {
    id,
    userId: USER_A,
    courseId: COURSE_A,
    title: status === "done" ? "Done task" : "Active task",
    description: null,
    deadline: new Date("2026-09-30T12:00:00.000Z"),
    status,
    createdAt: new Date("2026-09-01T08:00:00.000Z"),
    updatedAt: new Date("2026-09-05T00:00:00.000Z"),
    deadlineUpdatedAt: new Date("2026-09-01T08:00:00.000Z"),
    completedAt: status === "done" ? new Date("2026-09-06T00:00:00.000Z") : null,
    deletedAt: null,
  } as any;
}

function authed() {
  setVerifyAccessTokenOverride(async (token) => {
    if (token === "token-user-a") {
      return { id: USER_A, email: "user_a@example.com", sessionId: "sa" };
    }
    return null;
  });
  setLoadAuthorizationContextOverride(async (subject) =>
    createAuthorizationContext({
      subject,
      roles: ["user"],
      capabilities: [...DOMAIN_CAPABILITIES],
    }),
  );
  setOwnershipOverrides({
    ownedTask: async (userId, id) => {
      if (userId !== USER_A) return null;
      if (id === TASK_ACTIVE) return baseTaskRow(TASK_ACTIVE, "todo");
      if (id === TASK_DONE) return baseTaskRow(TASK_DONE, "done");
      return null;
    },
    ownedCourse: async (userId, courseId) => {
      if (userId === USER_A && courseId === COURSE_A) {
        return { id: COURSE_A, userId: USER_A } as any;
      }
      return null;
    },
  });
}

function jsonRequest(url: string, method: string, body?: unknown): Request {
  return new Request(url, {
    method,
    headers: {
      authorization: "Bearer token-user-a",
      "content-type": "application/json",
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

describe("Terminal Done — lifecycle guards", () => {
  beforeEach(() => {
    resetRateLimitBuckets();
    selectResultQueue = [[{ value: 0 }]];
    updateResultRows = [];
    authed();
  });

  test("POST create with status=done is rejected (400)", async () => {
    const res = await app.handle(
      jsonRequest("http://localhost/api/v1/tasks", "POST", {
        title: "Born done",
        course_id: COURSE_A,
        deadline: "2026-09-30T12:00:00.000Z",
        status: "done",
      }),
    );
    expect(res.status).toBe(400);
  });

  test("POST create with status=todo still works (200)", async () => {
    updateResultRows = [baseTaskRow("new-task", "todo")];
    const res = await app.handle(
      jsonRequest("http://localhost/api/v1/tasks", "POST", {
        title: "Born active",
        course_id: COURSE_A,
        deadline: "2026-09-30T12:00:00.000Z",
        status: "todo",
      }),
    );
    expect(res.status).toBe(200);
  });

  test("PATCH title on a done task is rejected (409 terminal)", async () => {
    const res = await app.handle(
      jsonRequest(`http://localhost/api/v1/tasks/${TASK_DONE}`, "PATCH", {
        title: "Edited after done",
      }),
    );
    expect(res.status).toBe(409);
    const body = (await res.json()) as any;
    expect(JSON.stringify(body)).toMatch(/read-only|Completed/i);
    expect(body?.error?.code).toBe("CONFLICT");
    expect(body?.requestId).toBeTruthy();
  });

  test("PATCH done → todo (reopen) is rejected (409)", async () => {
    const res = await app.handle(
      jsonRequest(`http://localhost/api/v1/tasks/${TASK_DONE}`, "PATCH", {
        status: "todo",
      }),
    );
    expect(res.status).toBe(409);
    const reopenBody = (await res.json()) as any;
    expect(reopenBody?.error?.code).toBe("CONFLICT");
    expect(reopenBody?.requestId).toBeTruthy();
  });

  test("PATCH title on an active task still works (200)", async () => {
    updateResultRows = [
      { ...baseTaskRow(TASK_ACTIVE, "todo"), title: "Renamed" },
    ];
    const res = await app.handle(
      jsonRequest(`http://localhost/api/v1/tasks/${TASK_ACTIVE}`, "PATCH", {
        title: "Renamed",
      }),
    );
    expect(res.status).toBe(200);
  });

  test("PATCH active → done (forward) still works (200)", async () => {
    updateResultRows = [baseTaskRow(TASK_ACTIVE, "done")];
    const res = await app.handle(
      jsonRequest(`http://localhost/api/v1/tasks/${TASK_ACTIVE}`, "PATCH", {
        status: "done",
      }),
    );
    expect(res.status).toBe(200);
  });

  test("POST /:id/complete on an already-done task is idempotent (200)", async () => {
    const res = await app.handle(
      jsonRequest(
        `http://localhost/api/v1/tasks/${TASK_DONE}/complete`,
        "POST",
      ),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.task.status).toBe("done");
  });
});
