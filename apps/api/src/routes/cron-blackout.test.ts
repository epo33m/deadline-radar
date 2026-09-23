// F-06: total delivery blackout still answers 200 {ok:true} (SEC-008
// contract intact) while raising the out-of-band Sentry alert.
process.env.NODE_ENV = "test";
process.env.AUTH_BRIDGE_SECRET ??= "test-auth-bridge-secret";
import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";

const savedCronSecret = process.env.CRON_SECRET;
const savedCutoff = process.env.REMINDER_CUTOFF_ISO;

const sentryCalls: unknown[][] = [];
const sentryExtras: Record<string, unknown>[] = [];
const fakeScope = {
  setLevel: (_level: unknown) => undefined,
  setExtras: (extra: Record<string, unknown>) => {
    sentryExtras.push(extra);
  },
};

mock.module("@sentry/bun", () => ({
  withScope: (cb: (scope: unknown) => void) => cb(fakeScope),
  captureMessage: (...args: unknown[]) => {
    sentryCalls.push(args);
  },
  captureException: (..._args: unknown[]) => undefined,
}));

const USER = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const TASK = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const THRESHOLD = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

let selectQueue: unknown[][] = [];
let insertCalls = 0;
// NEW-01: when true, the reminder_runs lock insert fails on every attempt
// (a persistent DB error), so the run must abort fail-closed.
let failRunsInsert = false;

function chainForSelect(rows: unknown[]) {
  const self: Record<string, (...args: never[]) => unknown> = {};
  self["from"] = () => self;
  self["where"] = () => self;
  self["orderBy"] = () => self;
  self["limit"] = (async () => rows) as never;
  self["then"] = ((resolve: (v: unknown) => void) =>
    Promise.resolve(rows).then(resolve)) as never;
  return self;
}

mock.module("../lib/db", () => ({
  getDb: () => ({
    select: () => chainForSelect(selectQueue.shift() ?? []),
    insert: () => ({
      values: (v: Record<string, unknown> | Record<string, unknown>[]) => {
        insertCalls += 1;
        if (failRunsInsert) throw new Error("db write failed");
        const id = insertCalls === 1 ? "run-1" : "dlv-1";
        // Batched creates map RETURNING rows back to actions by unique key,
        // so echo the first input row's key (as production RETURNING does).
        const first = (Array.isArray(v) ? v[0] : v) ?? {};
        const row = {
          id,
          thresholdId: first.thresholdId,
          daysBefore: first.daysBefore,
          channel: first.channel,
        };
        return {
          onConflictDoNothing: () => ({
            returning: async () => [row],
          }),
          returning: async () => [row],
        };
      },
    }),
    update: () => ({
      set: () => ({
        where: () => ({
          then: (resolve: (v: unknown) => void) =>
            Promise.resolve([]).then(resolve),
          returning: () => ({
            then: (resolve: (v: unknown) => void) =>
              Promise.resolve([]).then(resolve),
          }),
        }),
      }),
    }),
    delete: () => ({
      where: () => ({
        then: (resolve: (v: unknown) => void) =>
          Promise.resolve([]).then(resolve),
      }),
    }),
  }),
}));

mock.module("resend", () => ({
  Resend: class {
    emails = {
      send: async () => ({
        data: null,
        error: { name: "application_error", message: "boom", statusCode: 500 },
      }),
    };
  },
}));

const { resetRateLimitBuckets } = await import("../plugins/rate-limit");
const { setVerifyAccessTokenOverride } = await import("../lib/auth-tokens");
const {
  createAuthorizationContext,
  setLoadAuthorizationContextOverride,
} = await import("../lib/authorization");
const { DOMAIN_CAPABILITIES } = await import(
  "../lib/authorization/capabilities"
);
const { app } = await import("../app");

beforeEach(() => {
  resetRateLimitBuckets();
  sentryCalls.length = 0;
  sentryExtras.length = 0;
  selectQueue = [];
  insertCalls = 0;
  failRunsInsert = false;
  process.env.CRON_SECRET = "test-cron-secret";
  delete process.env.REMINDER_CUTOFF_ISO;

  setVerifyAccessTokenOverride(async () => null);
  setLoadAuthorizationContextOverride(async (subject) =>
    createAuthorizationContext({
      subject,
      roles: ["user"],
      capabilities: [...DOMAIN_CAPABILITIES],
    }),
  );
});

afterEach(() => {
  resetRateLimitBuckets();
  if (savedCronSecret === undefined) delete process.env.CRON_SECRET;
  else process.env.CRON_SECRET = savedCronSecret;
  if (savedCutoff === undefined) delete process.env.REMINDER_CUTOFF_ISO;
  else process.env.REMINDER_CUTOFF_ISO = savedCutoff;
});

describe("F-06 — blackout alert keeps the 200 contract", () => {
  test("all sends 500 → 200 {ok:true} + one Sentry blackout alert", async () => {
    const now = Date.now();
    const liveTaskRow = {
      id: TASK,
      userId: USER,
      status: "todo",
      deadline: new Date(now - 60_000),
      createdAt: new Date(now - 10 * 86_400_000),
      deadlineUpdatedAt: new Date(now - 10 * 86_400_000),
      title: "Task A",
    };
    selectQueue = [
      // purgeExpiredIdempotencyKeys scan (no expired keys)
      [],
      // taskRows: due H-1 threshold, created long ago
      [liveTaskRow],
      // thresholdRows
      [{ id: THRESHOLD, taskId: TASK, daysBefore: 1 }],
      // deliveryRows: none yet
      [],
      // profileRows
      [{ id: USER, email: "user@example.com", timezone: "UTC" }],
      // F-08 live-status re-check: still active
      [liveTaskRow],
      // RF-07 live threshold re-check: unchanged version
      [
        {
          id: THRESHOLD,
          taskId: TASK,
          daysBefore: 1,
          createdAt: new Date(now - 10 * 86_400_000),
        },
      ],
    ];

    const response = await app.handle(
      new Request("http://localhost/api/v1/cron/evaluate-reminders", {
        headers: { authorization: "Bearer test-cron-secret" },
      }),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });

    expect(sentryCalls).toHaveLength(1);
    expect(String(sentryCalls[0]?.[0])).toMatch(/blackout/);
    expect(sentryExtras).toHaveLength(1);
    expect(sentryExtras[0]).toMatchObject({
      runId: "run-1",
      emailsSent: 0,
      emailsFailed: 1,
    });
  });

  test("RF-08: poison-only failure (missing recipient) → 200 {ok:true} + no alert", async () => {
    const now = Date.now();
    const liveTaskRow = {
      id: TASK,
      userId: USER,
      status: "todo",
      deadline: new Date(now - 60_000),
      createdAt: new Date(now - 10 * 86_400_000),
      deadlineUpdatedAt: new Date(now - 10 * 86_400_000),
      title: "Task A",
    };
    selectQueue = [
      // purgeExpiredIdempotencyKeys scan (no expired keys)
      [],
      // taskRows: due H-1 threshold, created long ago
      [liveTaskRow],
      // thresholdRows
      [{ id: THRESHOLD, taskId: TASK, daysBefore: 1 }],
      // deliveryRows: none yet
      [],
      // profileRows: recipient email missing → deterministic poison
      [{ id: USER, email: "", timezone: "UTC" }],
      // F-08 live-status re-check: still active
      [liveTaskRow],
      // RF-07 live threshold re-check: unchanged version
      [
        {
          id: THRESHOLD,
          taskId: TASK,
          daysBefore: 1,
          createdAt: new Date(now - 10 * 86_400_000),
        },
      ],
    ];

    const response = await app.handle(
      new Request("http://localhost/api/v1/cron/evaluate-reminders", {
        headers: { authorization: "Bearer test-cron-secret" },
      }),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
    // Poison is a data-integrity condition, not a provider outage.
    expect(sentryCalls).toHaveLength(0);
  });

  test("idle run (nothing due) → 200 {ok:true} + no alert", async () => {
    selectQueue = [[], [], [], [], [], []];

    const response = await app.handle(
      new Request("http://localhost/api/v1/cron/evaluate-reminders", {
        headers: { authorization: "Bearer test-cron-secret" },
      }),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
    expect(sentryCalls).toHaveLength(0);
  });

  test("lock unavailable (DB error, every attempt) → 200 {ok:true} + lock-unavailable alert (NEW-01)", async () => {
    // The lock insert fails permanently: the run aborts fail-closed with no
    // work; the HTTP contract stays 200 and the infra signal goes Sentry.
    failRunsInsert = true;
    selectQueue = [[]]; // purgeExpiredIdempotencyKeys scan (no expired keys)

    const response = await app.handle(
      new Request("http://localhost/api/v1/cron/evaluate-reminders", {
        headers: { authorization: "Bearer test-cron-secret" },
      }),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });

    expect(sentryCalls).toHaveLength(1);
    expect(String(sentryCalls[0]?.[0])).toMatch(/lock unavailable/);
    expect(sentryExtras).toHaveLength(1);
    expect(sentryExtras[0]).toMatchObject({ runId: null });
  });
});
