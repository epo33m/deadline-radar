/**
 * #137 regression tests: the business insert and the idempotency completion
 * commit atomically, and a stale-reclaim re-execution replays the committed
 * row via the dedupe key instead of duplicating it.
 *
 * Route-level through `app.handle` with a recording mock DB that emulates
 * transaction rollback (snapshot + restore on throw) and enforces the
 * partial unique dedupe index on tasks(idempotency_key).
 */
process.env.NODE_ENV = "test";
process.env.AUTH_BRIDGE_SECRET ??= "test-auth-bridge-secret";
import { beforeEach, describe, expect, mock, test } from "bun:test";
import { idempotencyKeys, tasks } from "@deadline-radar/db";

import { resetRateLimitBuckets } from "../plugins/rate-limit";
import { setVerifyAccessTokenOverride } from "../lib/auth-tokens";
import {
  createAuthorizationContext,
  setLoadAuthorizationContextOverride,
  setOwnershipOverrides,
} from "../lib/authorization";
import { DOMAIN_CAPABILITIES } from "../lib/authorization/capabilities";
import { ApiError, API_ERROR_CODES } from "../lib/api/errors";
import {
  completeIdempotentInTx,
  isUniqueViolation,
  runTxWithCompletionRetry,
} from "../lib/api/idempotency";

const USER_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const COURSE_A = "11111111-1111-4111-8111-111111111111";
const TASK_PATH = "/api/v1/tasks";
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
  idempotencyKey: null,
};

type TaskRow = {
  id: string;
  userId: string;
  courseId: string;
  title: string;
  description: string | null;
  deadline: Date;
  status: "todo";
  completedAt: null;
  createdAt: Date;
  updatedAt: Date;
  deadlineUpdatedAt: Date;
  deletedAt: null;
  idempotencyKey: string | null;
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

let tasksStore = new Map<string, TaskRow>();
let idemRow: IdemRow | null = null;
let taskInserts = 0;
let txAttempts = 0;
/** Fail the next N UPDATEs on idempotency_keys (transient completion blip). */
let failIdemUpdateCount = 0;

function cloneTasks(): Map<string, TaskRow> {
  return new Map(
    [...tasksStore.entries()].map(([id, row]) => [id, { ...row }]),
  );
}

mock.module("../lib/db", () => {
  const db: any = {
    select: (fields?: unknown) => ({
      from: (table: unknown) => {
        const rows = (): unknown[] => {
          if (table === idempotencyKeys) {
            // Purge scans project `{ id }`; the claim lookup selects all.
            if (
              fields !== undefined &&
              Object.keys((fields ?? {}) as object).includes("id")
            ) {
              return [];
            }
            return idemRow ? [idemRow] : [];
          }
          if (table === tasks) {
            // SEC-003 quota count projects `{ value }`.
            if (fields !== undefined) return [{ value: 0 }];
            return [...tasksStore.values()];
          }
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
              if (idemRow) return [];
              idemRow = {
                id: `idem-${Date.now()}`,
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
              // Emulate the partial unique index
              // tasks_user_idempotency_key.
              const key = (v.idempotencyKey as string | null) ?? null;
              if (
                key !== null &&
                [...tasksStore.values()].some(
                  (r) => r.userId === v.userId && r.idempotencyKey === key,
                )
              ) {
                throw {
                  code: "23505",
                  message:
                    'duplicate key value violates unique constraint "tasks_user_idempotency_key"',
                };
              }
              taskInserts += 1;
              const row: TaskRow = {
                id: `task-${taskInserts}`,
                userId: v.userId as string,
                courseId: v.courseId as string,
                title: v.title as string,
                description: (v.description as string | null) ?? null,
                deadline: v.deadline as Date,
                status: "todo",
                completedAt: null,
                createdAt: new Date(),
                updatedAt: new Date(),
                deadlineUpdatedAt: new Date(),
                deletedAt: null,
                idempotencyKey: key,
              };
              tasksStore.set(row.id, row);
              return [row];
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
            if (failIdemUpdateCount > 0) {
              failIdemUpdateCount -= 1;
              throw new Error("fake db: tx completion update failed");
            }
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
    // Emulate rollback: a throwing callback restores the pre-tx snapshot.
    transaction: async (cb: (tx: unknown) => unknown) => {
      txAttempts += 1;
      const tasksSnapshot = cloneTasks();
      const idemSnapshot = idemRow ? { ...idemRow } : null;
      const insertsSnapshot = taskInserts;
      try {
        return await cb(db);
      } catch (error) {
        tasksStore = tasksSnapshot;
        idemRow = idemSnapshot;
        taskInserts = insertsSnapshot;
        throw error;
      }
    },
  };
  return { getDb: () => db };
});

mock.module("../lib/auth-audit", () => ({
  recordAuthEvent: async () => undefined,
}));

const { app } = await import("../app");

function taskRequest(key: string, body: unknown = {}) {
  return app.handle(
    new Request(`http://localhost${TASK_PATH}`, {
      method: "POST",
      headers: {
        authorization: "Bearer token-user-a",
        "content-type": "application/json",
        "idempotency-key": key,
      },
      body: JSON.stringify({
        title: "Task",
        course_id: COURSE_A,
        deadline: DEADLINE,
        status: "todo",
        ...((body ?? {}) as Record<string, unknown>),
      }),
    }),
  );
}

describe("#137: atomic insert-plus-completion", () => {
  beforeEach(() => {
    resetRateLimitBuckets();
    tasksStore = new Map();
    idemRow = null;
    taskInserts = 0;
    txAttempts = 0;
    failIdemUpdateCount = 0;

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

  test("transient completion failure still succeeds with exactly one row (I-02 via tx retry)", async () => {
    failIdemUpdateCount = 2;

    const res = await taskRequest("atomic-key-transient");
    expect(res.status).toBe(200);
    // First tx rolled back (0 rows), retry committed exactly one row.
    expect(tasksStore.size).toBe(1);
    expect(txAttempts).toBe(3);
    expect(idemRow?.responseStatus).toBe(200);

    const body = (await res.json()) as { task: { id: string } };
    const stored = [...tasksStore.values()][0]!;
    expect(body.task.id).toBe(stored.id);
    expect(stored.idempotencyKey).toBe("atomic-key-transient");

    // Same-key retry replays the stored response.
    const retry = await taskRequest("atomic-key-transient");
    expect(retry.status).toBe(200);
    expect(tasksStore.size).toBe(1);
    const retryBody = (await retry.json()) as { task: { id: string } };
    expect(retryBody.task.id).toBe(stored.id);
  });

  test("persistent completion failure commits nothing; retry is in-flight (no duplicate)", async () => {
    failIdemUpdateCount = 99;

    const res = await taskRequest("atomic-key-down");
    expect(res.status).toBe(500);
    expect(tasksStore.size).toBe(0);
    expect(taskInserts).toBe(0);
    // The claim is untouched (rollback) — the pre-existing in-flight
    // contract applies until the stale reclaim, which Layer B then replays.
    expect(idemRow?.responseStatus).toBeNull();

    const retry = await taskRequest("atomic-key-down");
    expect(retry.status).toBe(409);
    expect(tasksStore.size).toBe(0);
  });

  test("stale-reclaim re-execution replays the committed row via the dedupe key", async () => {
    // First attempt committed the business row but lost the completion;
    // the stale reclaim has since freed the claim.
    const seeded: TaskRow = {
      id: "task-seeded",
      userId: USER_A,
      courseId: COURSE_A,
      title: "Task",
      description: null,
      deadline: new Date(DEADLINE),
      status: "todo",
      completedAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
      deadlineUpdatedAt: new Date(),
      deletedAt: null,
      idempotencyKey: "atomic-key-stale",
    };
    tasksStore.set(seeded.id, seeded);
    expect(idemRow).toBeNull();

    const res = await taskRequest("atomic-key-stale");
    expect(res.status).toBe(200);
    // No second row was created.
    expect(tasksStore.size).toBe(1);
    expect(taskInserts).toBe(0);
    const body = (await res.json()) as { task: { id: string } };
    expect(body.task.id).toBe("task-seeded");
    // The claim is now completed, so further retries replay.
    expect(idemRow?.responseStatus).toBe(200);

    const retry = await taskRequest("atomic-key-stale");
    expect(retry.status).toBe(200);
    expect(tasksStore.size).toBe(1);
  });

  test("different body + same key still yields 409 IDEMPOTENCY_CONFLICT", async () => {
    const first = await taskRequest("atomic-key-conflict", { title: "One" });
    expect(first.status).toBe(200);

    const second = await taskRequest("atomic-key-conflict", { title: "Two" });
    expect(second.status).toBe(409);
    const body = (await second.json()) as {
      error?: { code?: string } | string;
    };
    const err = body.error;
    expect(typeof err === "string" ? err : err?.code).toBe(
      "IDEMPOTENCY_CONFLICT",
    );
    expect(tasksStore.size).toBe(1);
  });
});

describe("#137: tx retry helper semantics", () => {
  test("ApiError is never retried", async () => {
    let calls = 0;
    await expect(
      runTxWithCompletionRetry(async () => {
        calls += 1;
        throw ApiError.validation("bad");
      }),
    ).rejects.toThrow("bad");
    expect(calls).toBe(1);
  });

  test("unique violations are never retried (dedupe replay handles them)", async () => {
    let calls = 0;
    await expect(
      runTxWithCompletionRetry(async () => {
        calls += 1;
        throw { code: "23505", message: "duplicate key" };
      }),
    ).rejects.toEqual({ code: "23505", message: "duplicate key" });
    expect(calls).toBe(1);
  });

  test("transient unexpected failures retry bounded, then succeed", async () => {
    let calls = 0;
    const result = await runTxWithCompletionRetry(async () => {
      calls += 1;
      if (calls < 3) throw new Error("blip");
      return "ok";
    });
    expect(result).toBe("ok");
    expect(calls).toBe(3);
  });

  test("persistent unexpected failures throw after bounded attempts", async () => {
    let calls = 0;
    await expect(
      runTxWithCompletionRetry(async () => {
        calls += 1;
        throw new Error("down");
      }),
    ).rejects.toThrow("down");
    expect(calls).toBe(3);
  });

  test("completeIdempotentInTx writes through the tx handle and throws on failure", async () => {
    const written: unknown[] = [];
    const tx = {
      update: () => ({
        set: (s: unknown) => ({
          where: async () => {
            written.push(s);
          },
        }),
      }),
    };
    await completeIdempotentInTx(tx as never, {
      userId: USER_A,
      key: "k",
      statusCode: 200,
      body: { ok: true },
    });
    expect(written).toEqual([{ responseStatus: 200, responseBody: { ok: true } }]);

    const failingTx = {
      update: () => ({
        set: () => ({
          where: async () => {
            throw new Error("db down");
          },
        }),
      }),
    };
    await expect(
      completeIdempotentInTx(failingTx as never, {
        userId: USER_A,
        key: "k",
        statusCode: 200,
        body: {},
      }),
    ).rejects.toThrow("db down");
  });

  test("isUniqueViolation detects 23505 across shapes", () => {
    expect(isUniqueViolation({ code: "23505" })).toBe(true);
    expect(isUniqueViolation({ cause: { code: "23505" } })).toBe(true);
    expect(
      isUniqueViolation(
        new Error('duplicate key value violates unique constraint "x"'),
      ),
    ).toBe(true);
    expect(isUniqueViolation(ApiError.validation("bad"))).toBe(false);
    expect(isUniqueViolation(null)).toBe(false);
    expect(API_ERROR_CODES.IDEMPOTENCY_CONFLICT).toBe("IDEMPOTENCY_CONFLICT");
  });
});
