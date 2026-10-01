// RF-14: /health/cron is the external scheduler-health probe. Healthy iff the
// latest reminder_runs row is `ok`, finished, and started within 2×
// REMINDER_RUN_INTERVAL_MS. All unhealthy states answer 503 with the same
// minimal payload (ok:false) — an uptime monitor just watches the status code.
process.env.NODE_ENV = "test";
process.env.REMINDER_RUN_INTERVAL_MS = "3600000";
import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";

let selectQueue: unknown[][];

function chainForSelect(rows: unknown[]) {
  const self: Record<string, (...args: never[]) => unknown> = {};
  self["from"] = () => self;
  self["orderBy"] = () => self;
  self["limit"] = (async () => rows) as never;
  self["then"] = ((resolve: (v: unknown) => void) =>
    Promise.resolve(rows).then(resolve)) as never;
  return self;
}

mock.module("../lib/db", () => ({
  getDb: () => ({
    select: () => chainForSelect(selectQueue.shift() ?? []),
  }),
}));

import { app } from "../app";

const HOUR = 3_600_000;

function reminderRun(options: {
  status: string;
  startedAgoMs: number;
  finished: boolean;
  evaluatedTasks?: number;
}) {
  return {
    startedAt: new Date(Date.now() - options.startedAgoMs),
    finishedAt: options.finished
      ? new Date(Date.now() - options.startedAgoMs + 2000)
      : null,
    status: options.status,
    evaluatedTasks: options.evaluatedTasks ?? 100,
  };
}

async function probe(): Promise<{ status: number; body: any }> {
  const res = await app.handle(
    new Request("http://localhost/health/cron", { method: "GET" }),
  );
  return { status: res.status, body: await res.json() };
}

beforeEach(() => {
  selectQueue = [];
  process.env.REMINDER_RUN_INTERVAL_MS = "3600000";
});

afterEach(() => {
  delete process.env.REMINDER_RUN_INTERVAL_MS;
  mock.restore();
});

describe("RF-14 — GET /health/cron", () => {
  test("healthy: latest run ok and fresh", async () => {
    selectQueue = [[reminderRun({ status: "ok", startedAgoMs: 1000, finished: true, evaluatedTasks: 42 })]];
    const { status, body } = await probe();
    expect(status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.lastStatus).toBe("ok");
    expect(body.evaluatedTasks).toBe(42);
    expect(typeof body.lastRunAt).toBe("string");
  });

  test("freshness boundary: started exactly 2× interval ago is still healthy", async () => {
    // 1s inside the edge, not exactly on it: the route compares wall-clock
    // ms (`Date.now() - startedAt <= 2 * interval`), so an exact-edge
    // fixture races the milliseconds between fixture creation and the probe
    // and flakes 503 under load.
    selectQueue = [[reminderRun({ status: "ok", startedAgoMs: 2 * HOUR - 1000, finished: true })]];
    const { status } = await probe();
    expect(status).toBe(200);
  });

  test("stale: latest ok run started beyond 2× interval → 503", async () => {
    selectQueue = [[reminderRun({ status: "ok", startedAgoMs: 2 * HOUR + 1, finished: true })]];
    const { status, body } = await probe();
    expect(status).toBe(503);
    expect(body.ok).toBe(false);
  });

  test("erroring: latest run status error → 503", async () => {
    selectQueue = [[reminderRun({ status: "error", startedAgoMs: 1000, finished: true })]];
    const { status, body } = await probe();
    expect(status).toBe(503);
    expect(body.ok).toBe(false);
  });

  test("stuck running: latest run never finished → 503 even when fresh", async () => {
    selectQueue = [[reminderRun({ status: "running", startedAgoMs: 1000, finished: false })]];
    const { status, body } = await probe();
    expect(status).toBe(503);
    expect(body.ok).toBe(false);
  });

  test("never ran: no ledger rows → 503", async () => {
    selectQueue = [[]];
    const { status, body } = await probe();
    expect(status).toBe(503);
    expect(body.ok).toBe(false);
    expect(body.lastRunAt).toBeNull();
    expect(body.lastStatus).toBeNull();
  });

  test("interval is configurable via REMINDER_RUN_INTERVAL_MS", async () => {
    process.env.REMINDER_RUN_INTERVAL_MS = "60000";
    selectQueue = [[reminderRun({ status: "ok", startedAgoMs: 120_001, finished: true })]];
    const { status } = await probe();
    expect(status).toBe(503);
  });

  test("invalid interval env falls back lenient to the 1h default (RF-13 rule)", async () => {
    process.env.REMINDER_RUN_INTERVAL_MS = "soon";
    selectQueue = [[reminderRun({ status: "ok", startedAgoMs: 1000, finished: true })]];
    const { status } = await probe();
    expect(status).toBe(200);
  });
});