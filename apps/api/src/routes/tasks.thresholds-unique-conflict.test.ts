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
const TASK_A = "11111111-1111-4111-8111-111111111111";
const THRESHOLD_1 = "33333333-3333-4333-8333-333333333331";
const THRESHOLD_2 = "33333333-3333-4333-8333-333333333332";

let triggerUniqueViolationOnInsert = false;
let triggerUniqueViolationOnUpdate = false;
let triggerGenericError = false;

mock.module("../lib/db", () => {
  const db = {
    select: () => ({
      from: () => ({
        where: () => ({
          // RF-06: the natural-key conflict path re-reads the existing row on a
          // fresh connection, so this fake also carries threshold fields.
          limit: async () => [
            {
              timezone: "UTC",
              id: THRESHOLD_2,
              taskId: TASK_A,
              daysBefore: 7,
              isDefault: false,
              createdAt: new Date(),
            },
          ],
          orderBy: async () => [],
        }),
      }),
    }),
    insert: () => ({
      values: () => ({
        returning: async () => {
          if (triggerUniqueViolationOnInsert) {
            const err = new Error("duplicate key value violates unique constraint 'reminder_thresholds_task_id_days_before_key'");
            (err as any).code = "23505";
            throw err;
          }
          if (triggerGenericError) {
            throw new Error("connection lost");
          }
          return [
            {
              id: THRESHOLD_1,
              taskId: TASK_A,
              daysBefore: 5,
              isDefault: false,
              createdAt: new Date(),
            },
          ];
        },
      }),
    }),
    update: () => ({
      set: () => ({
        where: () => ({
          returning: async () => {
            if (triggerUniqueViolationOnUpdate) {
              const err = new Error("duplicate key value violates unique constraint 'reminder_thresholds_task_id_days_before_key'");
              (err as any).code = "23505";
              throw err;
            }
            if (triggerGenericError) {
              throw new Error("connection lost");
            }
            return [
              {
                id: THRESHOLD_1,
                taskId: TASK_A,
                daysBefore: 7,
                isDefault: false,
                createdAt: new Date(),
              },
            ];
          },
        }),
      }),
    }),
    // withUserRls single-tx handlers (P2-3): GUC setup is a no-op here.
    execute: async () => [],
    transaction: (cb: (tx: unknown) => unknown) => cb(db),
  };
  return { getDb: () => db };
});

const { app } = await import("../app");

describe("Finding L-9: POST & PATCH threshold unique constraint error handling", () => {
  beforeEach(() => {
    resetRateLimitBuckets();
    triggerUniqueViolationOnInsert = false;
    triggerUniqueViolationOnUpdate = false;
    triggerGenericError = false;

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
        if (userId === USER_A && id === TASK_A) {
          return {
            id: TASK_A,
            userId: USER_A,
            courseId: "course-1",
            title: "Task A",
            deadline: new Date(Date.now() + 30 * 86400000),
            status: "todo",
            deletedAt: null,
            createdAt: new Date(),
            updatedAt: new Date(),
            completedAt: null,
          } as any;
        }
        return null;
      },
    });
  });

  test("POST threshold with duplicate days_before returns 200 with the existing threshold (RF-06)", async () => {
    triggerUniqueViolationOnInsert = true;

    const res = await app.handle(
      new Request(`http://localhost/api/v1/tasks/${TASK_A}/thresholds`, {
        method: "POST",
        headers: {
          authorization: "Bearer token-user-a",
          "content-type": "application/json",
        },
        body: JSON.stringify({ days_before: 7 }),
      }),
    );

    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.threshold.id).toBe(THRESHOLD_2);
    expect(body.threshold.daysBefore).toBe(7);
  });

  test("PATCH threshold with duplicate days_before returns 409 CONFLICT", async () => {
    triggerUniqueViolationOnUpdate = true;

    const res = await app.handle(
      new Request(`http://localhost/api/v1/tasks/${TASK_A}/thresholds/${THRESHOLD_1}`, {
        method: "PATCH",
        headers: {
          authorization: "Bearer token-user-a",
          "content-type": "application/json",
        },
        body: JSON.stringify({ days_before: 7 }),
      }),
    );

    expect(res.status).toBe(409);
    const body = (await res.json()) as any;
    expect(body.error.code).toBe("CONFLICT");
    expect(body.error.message).toBe("Threshold already exists for this day offset");
  });

  test("PATCH threshold with generic DB failure produces 500 without masking", async () => {
    triggerGenericError = true;

    const res = await app.handle(
      new Request(`http://localhost/api/v1/tasks/${TASK_A}/thresholds/${THRESHOLD_1}`, {
        method: "PATCH",
        headers: {
          authorization: "Bearer token-user-a",
          "content-type": "application/json",
        },
        body: JSON.stringify({ days_before: 7 }),
      }),
    );

    expect(res.status).toBe(500);
  });
});
