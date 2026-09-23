process.env.NODE_ENV = "test";
process.env.AUTH_BRIDGE_SECRET ??= "test-auth-bridge-secret";
import { beforeEach, describe, expect, mock, test } from "bun:test";

import { resetRateLimitBuckets } from "../plugins/rate-limit";
import { setVerifyAccessTokenOverride } from "../lib/auth-tokens";
import {
  createAuthorizationContext,
  setLoadAuthorizationContextOverride,
  type Capability,
} from "../lib/authorization";

const USER = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

type NotificationDeliveryRow = {
  id: string;
  taskId: string;
  thresholdId: string;
  daysBefore: number;
  channel: string;
  status: string;
  retryCount: number;
  sentAt: Date;
  readAt: Date | null;
  createdAt: Date;
  taskTitle: string;
};

let deliveriesStore: NotificationDeliveryRow[] = [];

mock.module("../lib/db", () => ({
  getDb: () => {
    const chain = {
      select: () => chain,
      from: () => chain,
      innerJoin: () => chain,
      where: () => chain,
      orderBy: () => chain,
      limit: (n: number) => Promise.resolve(deliveriesStore.slice(0, n)),
    };
    return { select: () => chain };
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

function authedAs(userId: string, capabilities: Capability[] = ["notification.view"]) {
  setVerifyAccessTokenOverride(async () => ({
    id: userId,
    sessionId: "sess-1",
    email: "test@example.com",
  }));
  setLoadAuthorizationContextOverride(async (subject) =>
    createAuthorizationContext({
      subject,
      roles: ["user"],
      capabilities,
    }),
  );
}

beforeEach(() => {
  resetRateLimitBuckets();
  deliveriesStore = [];
});

describe("GET /api/v1/notifications — M-4 snapshot", () => {
  test("returns days_before directly from notification_deliveries snapshot", async () => {
    authedAs(USER);

    const now = new Date();
    deliveriesStore = [
      {
        id: "11111111-1111-4111-8111-111111111111",
        taskId: "22222222-2222-4222-8222-222222222222",
        thresholdId: "33333333-3333-4333-8333-333333333333",
        daysBefore: 3, // Snapshot: was delivered at H-3
        channel: "in_app",
        status: "sent",
        retryCount: 0,
        sentAt: now,
        readAt: null,
        createdAt: now,
        taskTitle: "Project Submission",
      },
    ];

    const res = await app.handle(
      new Request("http://localhost/api/v1/notifications", {
        headers: { authorization: "Bearer valid-token" },
      }),
    );

    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      notifications: { id: string; daysBefore: number; taskTitle: string }[];
    };
    expect(body.notifications).toHaveLength(1);
    expect(body.notifications[0].daysBefore).toBe(3);
    expect(body.notifications[0].taskTitle).toBe("Project Submission");
  });
});
