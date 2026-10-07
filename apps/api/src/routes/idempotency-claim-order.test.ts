/**
 * #136 regression tests: the idempotency key is claimed only AFTER the body
 * and its semantic preconditions validate, so a 400 never poisons the key.
 *
 * Route-level through `app.handle` with a recording mock DB (same strategy as
 * `tasks.thresholds-idempotency.test.ts`). The fake stores the claim so a
 * poisoned key is observable: before the fix the failed request leaves an
 * uncompleted row and the corrected same-key retry gets 409 instead of 200.
 */
process.env.NODE_ENV = "test";
process.env.AUTH_BRIDGE_SECRET ??= "test-auth-bridge-secret";
import { beforeEach, describe, expect, mock, test } from "bun:test";
import { courses, idempotencyKeys, tasks } from "@deadline-radar/db";

import { resetRateLimitBuckets } from "../plugins/rate-limit";
import { setVerifyAccessTokenOverride } from "../lib/auth-tokens";
import {
  createAuthorizationContext,
  setLoadAuthorizationContextOverride,
  setOwnershipOverrides,
} from "../lib/authorization";
import { DOMAIN_CAPABILITIES } from "../lib/authorization/capabilities";

const USER_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const COURSE_A = "11111111-1111-4111-8111-111111111111";
const COURSE_MISSING = "99999999-9999-4999-8999-999999999999";
const TASK_NEW = "22222222-2222-4222-8222-222222222222";
const TASK_PATH = "/api/v1/tasks";
const COURSE_PATH = "/api/v1/courses";
const DEADLINE = new Date(Date.now() + 7 * 86_400_000).toISOString();

const COURSE_ROW = {
  id: COURSE_A,
  userId: USER_A,
  name: "Course",
  code: null,
  color: null,
  icon: null,
  description: null,
  createdAt: new Date(),
  updatedAt: new Date(),
  deletedAt: null,
};

type IdemRow = {
  id: string;
  userId: string;
  key: string;
  method: string;
  path: string;
  requestHash: string;
  responseStatus: number | null;
  responseBody: unknown;
  createdAt: Date;
  expiresAt: Date;
};

let idemRow: IdemRow | null = null;
let idemInserts = 0;
let taskInserts = 0;
let courseInserts = 0;
let completedStatus: number | undefined;
let completedBody: unknown;

mock.module("../lib/db", () => {
  const db = {
    select: (fields?: unknown) => ({
      from: (table: unknown) => {
        const rows = (): unknown[] => {
          if (table === idempotencyKeys) {
            // Purge scans project `{ id }`; the claim lookup selects all.
            if (fields !== undefined) return [];
            return idemRow ? [idemRow] : [];
          }
          // SEC-003 quota count for task create.
          if (table === tasks) return [{ value: 0 }];
          return [];
        };
        const chain: any = {
          where: () => chain,
          orderBy: () => chain,
          limit: async () => rows(),
          then: (
            resolve: (v: unknown) => unknown,
            reject?: (e: unknown) => unknown,
          ) => Promise.resolve(rows()).then(resolve, reject),
        };
        return chain;
      },
    }),
    insert: (table: unknown) => ({
      values: (v: Record<string, unknown>) => {
        const builder: any = {
          onConflictDoNothing: () => builder,
          returning: async () => {
            if (table === idempotencyKeys) {
              idemInserts += 1;
              idemRow = {
                id: `idem-${idemInserts}`,
                userId: v.userId as string,
                key: v.key as string,
                method: v.method as string,
                path: v.path as string,
                requestHash: v.requestHash as string,
                responseStatus: null,
                responseBody: null,
                createdAt: new Date(),
                expiresAt: v.expiresAt as Date,
              };
              return [idemRow];
            }
            if (table === tasks) {
              taskInserts += 1;
              return [
                {
                  id: TASK_NEW,
                  userId: v.userId,
                  courseId: v.courseId,
                  title: v.title,
                  description: v.description ?? null,
                  deadline: v.deadline,
                  status: v.status,
                  completedAt: v.completedAt ?? null,
                  createdAt: new Date(),
                  updatedAt: new Date(),
                  deletedAt: null,
                },
              ];
            }
            if (table === courses) {
              courseInserts += 1;
              return [
                {
                  id: "course-new",
                  userId: v.userId,
                  name: v.name,
                  code: v.code ?? null,
                  color: v.color ?? null,
                  icon: v.icon ?? null,
                  description: v.description ?? null,
                  createdAt: new Date(),
                  updatedAt: new Date(),
                  deletedAt: null,
                },
              ];
            }
            return [];
          },
        };
        return builder;
      },
    }),
    update: (table: unknown) => ({
      set: (s: Record<string, unknown>) => ({
        where: async () => {
          if (table === idempotencyKeys) {
            completedStatus = s.responseStatus as number;
            completedBody = s.responseBody;
            if (idemRow) {
              idemRow.responseStatus = s.responseStatus as number;
              idemRow.responseBody = s.responseBody;
            }
          }
        },
      }),
    }),
    delete: (table: unknown) => ({
      where: () => ({
        returning: async () => [],
        then: (resolve: (v: unknown) => unknown) => {
          if (table === idempotencyKeys && idemRow?.responseStatus == null) {
            idemRow = null;
          }
          return Promise.resolve([]).then(resolve);
        },
      }),
    }),
    execute: async () => [],
    transaction: (cb: (tx: unknown) => unknown) => cb(db),
  };
  return { getDb: () => db };
});

mock.module("../lib/auth-audit", () => ({
  recordAuthEvent: async () => undefined,
}));

const { app } = await import("../app");

function taskRequest(
  key: string | undefined,
  body: unknown = {
    title: "Task",
    course_id: COURSE_A,
    deadline: DEADLINE,
    status: "todo",
  },
) {
  return app.handle(
    new Request(`http://localhost${TASK_PATH}`, {
      method: "POST",
      headers: {
        authorization: "Bearer token-user-a",
        "content-type": "application/json",
        ...(key ? { "idempotency-key": key } : {}),
      },
      body: JSON.stringify(body),
    }),
  );
}

function courseRequest(
  key: string | undefined,
  body: unknown = { name: "CS 101" },
) {
  return app.handle(
    new Request(`http://localhost${COURSE_PATH}`, {
      method: "POST",
      headers: {
        authorization: "Bearer token-user-a",
        "content-type": "application/json",
        ...(key ? { "idempotency-key": key } : {}),
      },
      body: JSON.stringify(body),
    }),
  );
}

describe("#136: idempotency claim happens after validation", () => {
  beforeEach(() => {
    resetRateLimitBuckets();
    idemRow = null;
    idemInserts = 0;
    taskInserts = 0;
    courseInserts = 0;
    completedStatus = undefined;
    completedBody = undefined;

    setVerifyAccessTokenOverride(async (token) =>
      token === "token-user-a"
        ? { id: USER_A, email: "user_a@example.com", sessionId: "sa" }
        : null,
    );
    setLoadAuthorizationContextOverride(async (subject) =>
      createAuthorizationContext({
        subject,
        roles: ["user"],
        capabilities: [...DOMAIN_CAPABILITIES],
      }),
    );
    setOwnershipOverrides({
      ownedCourse: async (userId, courseId) =>
        userId === USER_A && courseId === COURSE_A ? { ...COURSE_ROW } : null,
    });
  });

  test("task create: semantic 400 never claims; corrected retry with same key succeeds", async () => {
    const bad = await taskRequest("task-key-release", {
      title: "Task",
      course_id: COURSE_MISSING,
      deadline: DEADLINE,
      status: "todo",
    });
    expect(bad.status).toBe(400);
    expect(taskInserts).toBe(0);
    expect(idemInserts).toBe(0);
    expect(idemRow).toBeNull();

    const retry = await taskRequest("task-key-release", {
      title: "Task",
      course_id: COURSE_A,
      deadline: DEADLINE,
      status: "todo",
    });
    expect(retry.status).toBe(200);
    expect(taskInserts).toBe(1);
    expect(idemInserts).toBe(1);
    expect(completedStatus).toBe(200);
  });

  test("task create: invalid body never claims the key", async () => {
    const res = await taskRequest("task-key-invalid", {
      title: "",
      course_id: COURSE_A,
      deadline: DEADLINE,
      status: "todo",
    });
    expect(res.status).toBe(400);
    expect(taskInserts).toBe(0);
    expect(idemInserts).toBe(0);
    expect(idemRow).toBeNull();
  });

  test("course create: invalid body never claims; corrected retry with same key succeeds", async () => {
    const bad = await courseRequest("course-key-release", { name: "" });
    expect(bad.status).toBe(400);
    expect(courseInserts).toBe(0);
    expect(idemInserts).toBe(0);
    expect(idemRow).toBeNull();

    const retry = await courseRequest("course-key-release", { name: "CS 101" });
    expect(retry.status).toBe(200);
    expect(courseInserts).toBe(1);
    expect(idemInserts).toBe(1);
    expect(completedStatus).toBe(200);
  });
});
