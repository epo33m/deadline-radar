process.env.NODE_ENV = "test";
process.env.AUTH_BRIDGE_SECRET ??= "test-auth-bridge-secret";
import { beforeEach, describe, expect, mock, test } from "bun:test";

import { resetRateLimitBuckets } from "../plugins/rate-limit";
import { setVerifyAccessTokenOverride } from "../lib/auth-tokens";
import {
  createAuthorizationContext,
  setLoadAuthorizationContextOverride,
} from "../lib/authorization";
import { DOMAIN_CAPABILITIES } from "../lib/authorization/capabilities";

const USER_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const USER_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const TASK_ACTIVE = "11111111-1111-4111-8111-111111111111";
const TASK_DELETED = "22222222-2222-4222-8222-222222222222";
const NOTIF_ACTIVE = "33333333-3333-4333-8333-333333333331";
const NOTIF_DELETED = "33333333-3333-4333-8333-333333333332";

type MockNotif = {
  id: string;
  taskId: string;
  userId: string;
  deletedAt: Date | null;
  readAt: Date | null;
};

let notifStore: MockNotif[] = [];
let currentRequestedId = NOTIF_ACTIVE;
let currentCallerUserId = USER_A;
// I-07 spies: the folded mutation must issue one UPDATE and zero ownership
// SELECTs per mark-read.
let ownershipLookupUsed = false;
let updateCalls = 0;

mock.module("../lib/db", () => ({
  getDb: () => ({
    select: () => ({
      from: () => ({
        where: () => ({}),
        innerJoin: () => ({
          where: (clause: any) => ({
            limit: async () => {
              ownershipLookupUsed = true;
              const activeNotifs = notifStore.filter(
                (n) => n.deletedAt === null && n.userId === currentCallerUserId,
              );
              return activeNotifs.filter((n) => n.id === currentRequestedId);
            },
          }),
        }),
      }),
    }),
    update: () => ({
      set: (values: any) => ({
        where: () => ({
          // I-07: evaluate the folded ownership predicate (id + owner +
          // live) like the IN-subquery does in production.
          returning: async () => {
            updateCalls += 1;
            const row = notifStore.find(
              (n) =>
                n.id === currentRequestedId &&
                n.userId === currentCallerUserId &&
                n.deletedAt === null,
            );
            if (!row) return [];
            row.readAt = new Date();
            return [{ id: row.id }];
          },
        }),
      }),
    }),
  }),
}));

const { app } = await import("../app");

describe("Finding L-6: POST /api/v1/notifications/:id/read deleted task filtering", () => {
  beforeEach(() => {
    resetRateLimitBuckets();
    ownershipLookupUsed = false;
    updateCalls = 0;
    currentRequestedId = NOTIF_ACTIVE;
    currentCallerUserId = USER_A;
    notifStore = [
      {
        id: NOTIF_ACTIVE,
        taskId: TASK_ACTIVE,
        userId: USER_A,
        deletedAt: null,
        readAt: null,
      },
      {
        id: NOTIF_DELETED,
        taskId: TASK_DELETED,
        userId: USER_A,
        deletedAt: new Date(),
        readAt: null,
      },
    ];

    setVerifyAccessTokenOverride(async (token) => {
      if (token === "token-user-a") {
        return { id: USER_A, email: "user_a@example.com", sessionId: "sa" };
      }
      if (token === "token-user-b") {
        return { id: USER_B, email: "user_b@example.com", sessionId: "sb" };
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
  });

  test("marking active task notification as read returns 200 { ok: true }", async () => {
    currentRequestedId = NOTIF_ACTIVE;
    const res = await app.handle(
      new Request(`http://localhost/api/v1/notifications/${NOTIF_ACTIVE}/read`, {
        method: "POST",
        headers: {
          authorization: "Bearer token-user-a",
        },
      }),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.ok).toBe(true);
  });

  test("I-07: happy path issues one UPDATE and zero ownership SELECTs", async () => {
    currentRequestedId = NOTIF_ACTIVE;
    const res = await app.handle(
      new Request(`http://localhost/api/v1/notifications/${NOTIF_ACTIVE}/read`, {
        method: "POST",
        headers: {
          authorization: "Bearer token-user-a",
        },
      }),
    );
    expect(res.status).toBe(200);
    expect(updateCalls).toBe(1);
    expect(ownershipLookupUsed).toBe(false);
    expect(
      notifStore.find((n) => n.id === NOTIF_ACTIVE)?.readAt,
    ).toBeInstanceOf(Date);
  });

  test("I-07: missing id and not-owned yield byte-identical 404s", async () => {
    const missingId = "99999999-9999-4999-8999-999999999999";
    currentRequestedId = missingId;
    const missingRes = await app.handle(
      new Request(`http://localhost/api/v1/notifications/${missingId}/read`, {
        method: "POST",
        headers: {
          authorization: "Bearer token-user-a",
        },
      }),
    );
    expect(missingRes.status).toBe(404);

    currentRequestedId = NOTIF_ACTIVE;
    currentCallerUserId = USER_B;
    const notOwnedRes = await app.handle(
      new Request(`http://localhost/api/v1/notifications/${NOTIF_ACTIVE}/read`, {
        method: "POST",
        headers: {
          authorization: "Bearer token-user-b",
        },
      }),
    );
    expect(notOwnedRes.status).toBe(404);

    // Same generic 404 contract (requestIds are per-request by design).
    const missingBody = (await missingRes.json()) as Record<string, unknown>;
    const notOwnedBody = (await notOwnedRes.json()) as Record<string, unknown>;
    delete missingBody.requestId;
    delete notOwnedBody.requestId;
    expect(notOwnedBody).toEqual(missingBody);
  });

  test("I-07: row vanishing mid-flight still yields 404", async () => {
    currentRequestedId = NOTIF_ACTIVE;
    notifStore = notifStore.filter((n) => n.id !== NOTIF_ACTIVE);
    const res = await app.handle(
      new Request(`http://localhost/api/v1/notifications/${NOTIF_ACTIVE}/read`, {
        method: "POST",
        headers: {
          authorization: "Bearer token-user-a",
        },
      }),
    );
    expect(res.status).toBe(404);
  });

  test("marking soft-deleted task notification as read returns 404 Not Found", async () => {
    currentRequestedId = NOTIF_DELETED;
    const res = await app.handle(
      new Request(`http://localhost/api/v1/notifications/${NOTIF_DELETED}/read`, {
        method: "POST",
        headers: {
          authorization: "Bearer token-user-a",
        },
      }),
    );
    expect(res.status).toBe(404);
  });

  test("marking other user's notification as read returns 404 Not Found", async () => {
    currentRequestedId = NOTIF_ACTIVE;
    currentCallerUserId = USER_B;
    const res = await app.handle(
      new Request(`http://localhost/api/v1/notifications/${NOTIF_ACTIVE}/read`, {
        method: "POST",
        headers: {
          authorization: "Bearer token-user-b",
        },
      }),
    );
    expect(res.status).toBe(404);
  });
});
