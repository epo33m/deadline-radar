process.env.NODE_ENV = "test";
process.env.AUTH_BRIDGE_SECRET ??= "test-auth-bridge-secret";
import { beforeEach, describe, expect, mock, test } from "bun:test";
import { idempotencyKeys, reminderThresholds } from "@deadline-radar/db";

import { resetRateLimitBuckets } from "../plugins/rate-limit";
import { setVerifyAccessTokenOverride } from "../lib/auth-tokens";
import {
  createAuthorizationContext,
  setLoadAuthorizationContextOverride,
  setOwnershipOverrides,
} from "../lib/authorization";
import { DOMAIN_CAPABILITIES } from "../lib/authorization/capabilities";
import { hashRequestFingerprint } from "../lib/api";

const USER_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const TASK_A = "11111111-1111-4111-8111-111111111111";
const THRESHOLD_1 = "33333333-3333-4333-8333-333333333331";
const PATH = `/api/v1/tasks/${TASK_A}/thresholds`;
const BODY = { days_before: 5 };

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
let thresholdInserts = 0;
let idemInserts = 0;
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
          return [{ timezone: "UTC", value: 0 }];
        };
        const chain: any = {
          where: () => chain,
          orderBy: () => chain,
          limit: async () => rows(),
          then: (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) =>
            Promise.resolve(rows()).then(resolve, reject),
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
              return [{ id: `idem-${idemInserts}`, ...v }];
            }
            if (table === reminderThresholds) {
              thresholdInserts += 1;
              return [
                {
                  id: THRESHOLD_1,
                  taskId: TASK_A,
                  daysBefore: v.daysBefore,
                  isDefault: false,
                  createdAt: new Date(),
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
          }
        },
      }),
    }),
    delete: () => ({
      where: () => ({
        returning: async () => [],
        then: (resolve: (v: unknown) => unknown) => Promise.resolve([]).then(resolve),
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

function thresholdRequest(key?: string) {
  return app.handle(
    new Request(`http://localhost${PATH}`, {
      method: "POST",
      headers: {
        authorization: "Bearer token-user-a",
        "content-type": "application/json",
        ...(key ? { "idempotency-key": key } : {}),
      },
      body: JSON.stringify(BODY),
    }),
  );
}

describe("RF-06: threshold POST idempotency wiring", () => {
  beforeEach(() => {
    resetRateLimitBuckets();
    idemRow = null;
    thresholdInserts = 0;
    idemInserts = 0;
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
      ownedTask: async (userId, id) =>
        userId === USER_A && id === TASK_A
          ? {
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
            } as any
          : null,
    });
  });

  test("claims the key, creates the threshold, and completes with the response", async () => {
    const res = await thresholdRequest("threshold-key-1");

    expect(res.status).toBe(200);
    expect(thresholdInserts).toBe(1);
    expect(idemInserts).toBe(1);
    expect(completedStatus).toBe(200);
    expect((completedBody as any).threshold.id).toBe(THRESHOLD_1);
  });

  test("replays a stored response without inserting a threshold", async () => {
    const stored = {
      threshold: {
        id: THRESHOLD_1,
        taskId: TASK_A,
        daysBefore: 5,
        isDefault: false,
        createdAt: new Date().toISOString(),
      },
    };
    idemRow = {
      id: "idem-seed",
      userId: USER_A,
      key: "threshold-key-replay",
      method: "POST",
      path: PATH,
      requestHash: hashRequestFingerprint("POST", PATH, BODY),
      responseStatus: 200,
      responseBody: stored,
      createdAt: new Date(),
      expiresAt: new Date(Date.now() + 60 * 60 * 1000),
    };

    const res = await thresholdRequest("threshold-key-replay");

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(stored);
    expect(thresholdInserts).toBe(0);
    expect(idemInserts).toBe(0);
    expect(completedStatus).toBeUndefined();
  });

  test("no key sent → no idempotency record, threshold still created", async () => {
    const res = await thresholdRequest();

    expect(res.status).toBe(200);
    expect(thresholdInserts).toBe(1);
    expect(idemInserts).toBe(0);
    expect(completedStatus).toBeUndefined();
  });
});
