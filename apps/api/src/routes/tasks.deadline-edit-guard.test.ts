// F-01: PATCH task deadline advances `deadlineUpdatedAt` (the reminder
// edit-guard clock); unrelated edits must leave it alone, or due reminders
// would be wrongly suppressed by evaluateReminders (DOMAIN.md §4).
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

let lastSetPayload: Record<string, unknown> | null = null;

mock.module("../lib/db", () => {
  const updateChain = () => ({
    set: (payload: Record<string, unknown>) => {
      lastSetPayload = payload;
      return {
        where: (..._args: unknown[]) => ({
          returning: async () => [
            {
              id: TASK_A,
              userId: USER_A,
              courseId: "course-1",
              title: "Task A",
              description: null,
              deadline: new Date("2026-09-12T12:00:00.000Z"),
              status: "todo",
              createdAt: new Date("2026-09-01T08:00:00.000Z"),
              updatedAt: new Date(),
              completedAt: null,
              deletedAt: null,
            },
          ],
        }),
      };
    },
  });
  // withUserRls single-tx handlers (P2-3): GUC setup is a no-op here.
  const tx = { update: updateChain, execute: async () => [] };
  return {
    getDb: () => ({
      update: updateChain,
      execute: async () => [],
      transaction: (cb: (t: unknown) => unknown) => cb(tx),
    }),
  };
});

const { app } = await import("../app");

function patchRequest(body: Record<string, unknown>): Request {
  return new Request(`http://localhost/api/v1/tasks/${TASK_A}`, {
    method: "PATCH",
    headers: {
      authorization: "Bearer token-user-a",
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  });
}

describe("F-01 — PATCH task deadline edit-guard clock", () => {
  beforeEach(() => {
    resetRateLimitBuckets();
    lastSetPayload = null;

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
            deadline: new Date("2026-09-30T12:00:00.000Z"),
            status: "todo",
            deletedAt: null,
            createdAt: new Date("2026-09-01T08:00:00.000Z"),
            updatedAt: new Date("2026-09-05T00:00:00.000Z"),
            completedAt: null,
          } as any;
        }
        return null;
      },
    });
  });

  test("PATCH deadline bumps deadlineUpdatedAt", async () => {
    const res = await app.handle(
      patchRequest({ deadline: "2026-09-12T12:00:00.000Z" }),
    );
    expect(res.status).toBe(200);
    expect(lastSetPayload?.deadline).toBeInstanceOf(Date);
    expect(lastSetPayload?.deadlineUpdatedAt).toBeInstanceOf(Date);
  });

  test("PATCH title leaves deadlineUpdatedAt alone", async () => {
    const res = await app.handle(patchRequest({ title: "New title" }));
    expect(res.status).toBe(200);
    expect(lastSetPayload?.title).toBe("New title");
    expect("deadlineUpdatedAt" in (lastSetPayload ?? {})).toBe(false);
  });
});
