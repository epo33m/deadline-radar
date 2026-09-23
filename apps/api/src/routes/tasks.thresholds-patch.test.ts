// I-5: PATCH threshold keeps `is_default` consistent with the PUT contract.
// Editing a threshold to a default offset (7/3/1/0) re-marks it default;
// editing to a custom offset clears the marker. is_default remains metadata
// only — scheduling depends on days_before, never on the flag.
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

let lastSetPayload: Record<string, unknown> | null = null;

mock.module("../lib/db", () => {
  const updateChain = () => ({
    set: (payload: Record<string, unknown>) => {
      lastSetPayload = payload;
      return {
        where: () => ({
          returning: async () => [
            {
              id: THRESHOLD_1,
              taskId: TASK_A,
              daysBefore: payload.daysBefore,
              isDefault: payload.isDefault,
              createdAt: new Date(),
            },
          ],
        }),
      };
    },
  });
  const selectChain = () => ({
    from: () => ({
      where: () => ({
        limit: async () => [{ timezone: "UTC" }],
      }),
    }),
  });
  // withUserRls single-tx handlers (P2-3): GUC setup is a no-op here.
  const tx = { select: selectChain, update: updateChain, execute: async () => [] };
  return {
    getDb: () => ({
      select: selectChain,
      update: updateChain,
      execute: async () => [],
      transaction: (cb: (t: unknown) => unknown) => cb(tx),
    }),
  };
});

const { app } = await import("../app");

function patchRequest(thresholdId: string, daysBefore: number): Request {
  return new Request(
    `http://localhost/api/v1/tasks/${TASK_A}/thresholds/${thresholdId}`,
    {
      method: "PATCH",
      headers: {
        authorization: "Bearer token-user-a",
        "content-type": "application/json",
      },
      body: JSON.stringify({ days_before: daysBefore }),
    },
  );
}

describe("I-5 — PATCH threshold is_default consistency", () => {
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

  test("editing a threshold to a default offset re-marks is_default true", async () => {
    const res = await app.handle(patchRequest(THRESHOLD_1, 7));
    expect(res.status).toBe(200);
    expect(lastSetPayload).toMatchObject({ daysBefore: 7, isDefault: true });
    // F-01: offset edits advance the per-threshold edit-guard clock.
    expect(lastSetPayload?.updatedAt).toBeInstanceOf(Date);
    const body = (await res.json()) as any;
    expect(body.threshold.isDefault).toBe(true);
  });

  test("editing a threshold to a custom offset clears is_default", async () => {
    const res = await app.handle(patchRequest(THRESHOLD_1, 5));
    expect(res.status).toBe(200);
    expect(lastSetPayload).toMatchObject({ daysBefore: 5, isDefault: false });
    expect(lastSetPayload?.updatedAt).toBeInstanceOf(Date);
    const body = (await res.json()) as any;
    expect(body.threshold.isDefault).toBe(false);
  });
});