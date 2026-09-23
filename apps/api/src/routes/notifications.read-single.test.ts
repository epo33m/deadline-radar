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

mock.module("../lib/db", () => ({
  getDb: () => ({
    select: () => ({
      from: () => ({
        where: () => ({}),
        innerJoin: () => ({
          where: (clause: any) => ({
            limit: async () => {
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
          returning: async () => {
            return [{ id: NOTIF_ACTIVE }];
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
