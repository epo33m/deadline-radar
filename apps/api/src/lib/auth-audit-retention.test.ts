/**
 * Finding L-11 regression tests: auth_audit_events retention lifecycle.
 *
 * Retention is deliberately policy-driven (AUTH_AUDIT_RETENTION_DAYS — set by
 * product/legal, NOT hard-coded here). While unset, the trail stays append-only
 * and the purge is a no-op. Once set, the purge runs only from the
 * CRON_SECRET-gated server endpoint, in bounded batches, using the existing
 * idx_auth_audit_events_created_at index.
 *
 * The fake DB evaluates the real captured drizzle conditions
 * (`created_at < cutoff` for the select, `id IN (...)` for the delete) against
 * an in-memory store, so the purge logic runs exactly as in production.
 */
process.env.NODE_ENV = "test";
process.env.AUTH_BRIDGE_SECRET ??= "test-auth-bridge-secret";
import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { Param, SQL } from "drizzle-orm";
import { authAuditEvents } from "@deadline-radar/db";

import {
  AUTH_AUDIT_RETENTION_ENV,
  authAuditRetentionCutoff,
  getAuthAuditRetentionDays,
  purgeExpiredAuthAuditEvents,
} from "./auth-audit-retention";

type AuditRow = {
  id: string;
  event: string;
  userId: string | null;
  sessionId: string | null;
  result: string;
  method: string | null;
  ip: string | null;
  userAgent: string | null;
  requestId: string | null;
  metadata: Record<string, unknown> | null;
  createdAt: Date;
};

let seq = 0;
const auditStore = new Map<string, AuditRow>();
const nowMs = Date.now();
const DAY = 24 * 60 * 60 * 1000;

function row(partial: Partial<AuditRow> & { createdAt: Date }): AuditRow {
  return {
    id: partial.id ?? `row-${++seq}-${Math.random()}`,
    event: partial.event ?? "login",
    userId: partial.userId ?? null,
    sessionId: partial.sessionId ?? null,
    result: partial.result ?? "success",
    method: partial.method ?? null,
    ip: partial.ip ?? "127.0.0.1",
    userAgent: partial.userAgent ?? "test-agent",
    requestId: partial.requestId ?? null,
    metadata: partial.metadata ?? null,
    createdAt: partial.createdAt,
  };
}

function insertRow(partial: Partial<AuditRow> & { createdAt: Date }): void {
  const r = row(partial);
  auditStore.set(r.id, r);
}

// ---------------------------------------------------------------------------
// Drizzle SQL inspection for the exact shapes the purge emits.
// ---------------------------------------------------------------------------
function isColumnNode(node: unknown): node is { name: string } {
  if (node === null || typeof node !== "object" || node instanceof SQL) {
    return false;
  }
  const record = node as unknown as Record<string, unknown>;
  return "table" in record && typeof record["name"] === "string";
}

function walk(node: unknown, params: unknown[], text: string[]): void {
  if (node instanceof SQL) {
    for (const c of node.queryChunks) walk(c, params, text);
  } else if (node instanceof Param) {
    params.push((node as Param<unknown>).value);
  } else if (typeof node === "string") {
    text.push(node);
  } else if (Array.isArray(node)) {
    for (const c of node) walk(c, params, text);
  } else if (isColumnNode(node)) {
    text.push(node.name);
  } else if (
    node !== null &&
    typeof node === "object" &&
    Array.isArray((node as { value?: unknown }).value) &&
    ((node as { value: unknown[] }).value as unknown[]).every(
      (c) => typeof c === "string",
    )
  ) {
    text.push(((node as { value: string[] }).value as string[]).join(""));
  }
}

function inspect(cond: unknown): { params: unknown[]; text: string } {
  const params: unknown[] = [];
  const text: string[] = [];
  walk(cond, params, text);
  return { params, text: text.join("") };
}

function selectRowIds(cond: unknown): string[] {
  const { params, text } = inspect(cond);
  if (!/\bcreated_at\b/.test(text)) {
    // Not an audit select (e.g. idempotency purge) — no matching store.
    return [];
  }
  if (!/created_at\s*<\s*$/.test(text)) {
    throw new Error(`expected strict created_at < cutoff, got: ${text}`);
  }
  if (params.length !== 1) {
    throw new Error(`expected 1 cutoff param, got ${params.length}`);
  }
  const cutoff = params[0];
  if (!(cutoff instanceof Date)) {
    throw new Error("cutoff is not a Date");
  }
  return [...auditStore.values()]
    .filter((r) => r.createdAt.getTime() < cutoff.getTime())
    .map((r) => r.id);
}

function deleteRowIds(cond: unknown): AuditRow[] {
  const { params } = inspect(cond);
  const ids = new Set(params.map((p) => String(p)));
  const removed: AuditRow[] = [];
  for (const [key, value] of auditStore) {
    if (ids.has(String(value.id))) {
      removed.push(value);
      auditStore.delete(key);
    }
  }
  return removed;
}

const fakeDb = {
  select: () => ({
    from: () => ({
      where: (cond: unknown) => ({
        limit: async (n: number) =>
          selectRowIds(cond)
            .slice(0, n)
            .map((id) => ({ id })),
        orderBy: () => ({
          limit: async (n: number) =>
            selectRowIds(cond)
              .slice(0, n)
              .map((id) => ({ id })),
        }),
        // Direct await (no .limit) — used by non-audit selects that the
        // in-memory store does not track; they resolve to "no rows".
        then: (resolve: (v: unknown) => unknown) =>
          Promise.resolve(selectRowIds(cond).map((id) => ({ id }))).then(
            resolve,
          ),
      }),
    }),
  }),
  delete: () => ({
    where: (cond: unknown) => ({
      returning: async () => deleteRowIds(cond).map((r) => ({ id: r.id })),
    }),
  }),
  insert: (_table?: unknown) => ({
    values: async (val: Partial<AuditRow>) => {
      const inserted = {
        id: val.id ?? `row-${++seq}`,
        event: val.event ?? "login",
        userId: val.userId ?? null,
        sessionId: val.sessionId ?? null,
        result: val.result ?? "success",
        method: val.method ?? null,
        ip: val.ip ?? null,
        userAgent: val.userAgent ?? null,
        requestId: val.requestId ?? null,
        metadata: val.metadata ?? null,
        createdAt: val.createdAt ?? new Date(),
      };
      auditStore.set(inserted.id, inserted);
    },
  }),
  update: () => ({
    set: () => ({
      where: () => ({
        then: (resolve: (v: unknown) => unknown) =>
          Promise.resolve({}).then(resolve),
      }),
    }),
  }),
};

mock.module("./db", () => ({ getDb: () => fakeDb }));

const savedRetention = process.env[AUTH_AUDIT_RETENTION_ENV];
const savedCronSecret = process.env.CRON_SECRET;

const { resetRateLimitBuckets } = await import("../plugins/rate-limit");
const { app } = await import("../app");

beforeEach(() => {
  auditStore.clear();
  seq = 0;
  process.env[AUTH_AUDIT_RETENTION_ENV] = "30";
  process.env.CRON_SECRET = "test-cron-secret";
  resetRateLimitBuckets();
});

afterEach(() => {
  auditStore.clear();
  resetRateLimitBuckets();
  if (savedRetention === undefined) delete process.env[AUTH_AUDIT_RETENTION_ENV];
  else process.env[AUTH_AUDIT_RETENTION_ENV] = savedRetention;
  if (savedCronSecret === undefined) delete process.env.CRON_SECRET;
  else process.env.CRON_SECRET = savedCronSecret;
});

describe("L-11 auth audit retention — configuration", () => {
  test("retention days read from env; invalid values treated as unset", () => {
    process.env[AUTH_AUDIT_RETENTION_ENV] = "90";
    expect(getAuthAuditRetentionDays()).toBe(90);
    process.env[AUTH_AUDIT_RETENTION_ENV] = "0";
    expect(getAuthAuditRetentionDays()).toBeNull();
    process.env[AUTH_AUDIT_RETENTION_ENV] = "-5";
    expect(getAuthAuditRetentionDays()).toBeNull();
    process.env[AUTH_AUDIT_RETENTION_ENV] = "abc";
    expect(getAuthAuditRetentionDays()).toBeNull();
    delete process.env[AUTH_AUDIT_RETENTION_ENV];
    expect(getAuthAuditRetentionDays()).toBeNull();
  });

  test("cutoff is now minus retention days from the env value", () => {
    process.env[AUTH_AUDIT_RETENTION_ENV] = "30";
    const now = new Date(nowMs);
    const cutoff = authAuditRetentionCutoff(now);
    expect(cutoff?.getTime()).toBe(nowMs - 30 * DAY);
    delete process.env[AUTH_AUDIT_RETENTION_ENV];
    expect(authAuditRetentionCutoff(now)).toBeNull();
  });
});

describe("L-11 auth audit retention — purge semantics", () => {
  test("A. no retention configured -> purge is a safe no-op (deferral)", async () => {
    delete process.env[AUTH_AUDIT_RETENTION_ENV];
    insertRow({ event: "login", result: "failure", createdAt: new Date(nowMs - 400 * DAY) });
    const deleted = await purgeExpiredAuthAuditEvents({ now: new Date(nowMs) });
    expect(deleted).toBe(0);
    expect(auditStore.size).toBe(1);
  });

  test("B. expired events are purged; recent events are retained", async () => {
    insertRow({ event: "login", result: "failure", createdAt: new Date(nowMs - 40 * DAY) });
    insertRow({ event: "login", result: "success", createdAt: new Date(nowMs - 1 * DAY) });
    const deleted = await purgeExpiredAuthAuditEvents({ now: new Date(nowMs) });
    expect(deleted).toBe(1);
    const remaining = [...auditStore.values()];
    expect(remaining.length).toBe(1);
    expect(remaining[0].event).toBe("login");
    expect(remaining[0].createdAt.getTime()).toBe(nowMs - 1 * DAY);
  });

  test("C. cleanup is repeatable — second run is an error-free no-op", async () => {
    insertRow({ event: "login", createdAt: new Date(nowMs - 40 * DAY) });
    const first = await purgeExpiredAuthAuditEvents({ now: new Date(nowMs) });
    const second = await purgeExpiredAuthAuditEvents({ now: new Date(nowMs) });
    expect(first).toBe(1);
    expect(second).toBe(0);
    expect(auditStore.size).toBe(0);
  });

  test("D. boundary: events at or after the cutoff are not deleted", async () => {
    const cutoff = new Date(nowMs - 30 * DAY);
    insertRow({ id: "exact-cutoff", createdAt: new Date(cutoff.getTime()) });
    insertRow({ id: "just-after", createdAt: new Date(cutoff.getTime() + 1) });
    insertRow({ id: "just-before", createdAt: new Date(cutoff.getTime() - 1) });
    const deleted = await purgeExpiredAuthAuditEvents({ now: new Date(nowMs) });
    expect(deleted).toBe(1);
    expect(auditStore.has("exact-cutoff")).toBe(true);
    expect(auditStore.has("just-after")).toBe(true);
    expect(auditStore.has("just-before")).toBe(false);
  });

  test("E. batching: more rows than one batch need repeated runs, recent always kept", async () => {
    for (let i = 0; i < 25; i += 1) {
      insertRow({ id: `old-${i}`, createdAt: new Date(nowMs - (40 + i) * DAY) });
    }
    insertRow({ id: "recent-1", event: "authz.denied", createdAt: new Date(nowMs - 60_000) });
    insertRow({ id: "recent-2", createdAt: new Date(nowMs - 30_000) });

    const now = new Date(nowMs);
    const first = await purgeExpiredAuthAuditEvents({ now, limit: 10 });
    const second = await purgeExpiredAuthAuditEvents({ now, limit: 10 });
    const third = await purgeExpiredAuthAuditEvents({ now, limit: 10 });
    const fourth = await purgeExpiredAuthAuditEvents({ now, limit: 10 });

    expect(first + second + third + fourth).toBe(25);
    expect(auditStore.size).toBe(2);
    expect(auditStore.has("recent-1")).toBe(true);
    expect(auditStore.has("recent-2")).toBe(true);
    for (let i = 0; i < 25; i += 1) {
      expect(auditStore.has(`old-${i}`)).toBe(false);
    }
  });

  test("F. overlapping purge executions are safe (idempotent)", async () => {
    for (let i = 0; i < 20; i += 1) {
      insertRow({ id: `old-${i}`, createdAt: new Date(nowMs - (40 + i) * DAY) });
    }
    const [a, b] = await Promise.all([
      purgeExpiredAuthAuditEvents({ now: new Date(nowMs), limit: 20 }),
      purgeExpiredAuthAuditEvents({ now: new Date(nowMs), limit: 20 }),
    ]);
    // Exactly one of the two concurrent runs wins the batch; the other sees 0.
    expect(a + b).toBe(20);
    expect(auditStore.size).toBe(0);
  });

  test("G. existing authentication audit events are recorded and retained while recent", async () => {
    // Same insert the auth write path (recordAuthEvent in ./auth-audit.ts)
    // performs; the retention change must not interfere with it.
    const now = new Date(nowMs);
    await fakeDb.insert(authAuditEvents).values({
      event: "login",
      result: "failure",
      userId: "11111111-1111-4111-8111-111111111111",
      sessionId: null,
      method: null,
      ip: "203.0.113.7",
      userAgent: "test-uagent/1.0",
      requestId: "req-1",
      metadata: { capability: "test" },
      createdAt: now,
    });
    expect(auditStore.size).toBe(1);
    const written = [...auditStore.values()][0];
    expect(written.event).toBe("login");
    expect(written.result).toBe("failure");
    expect(written.userId).toBe("11111111-1111-4111-8111-111111111111");
    expect(written.ip).toBe("203.0.113.7");
    expect(written.userAgent).toBe("test-uagent/1.0");

    const deleted = await purgeExpiredAuthAuditEvents({ now });
    expect(deleted).toBe(0);
    expect(auditStore.size).toBe(1);
  });
});

describe("L-11 auth audit retention — server-side authorization", () => {
  test("F1. missing/wrong cron secret -> 401 and no rows are purged", async () => {
    insertRow({ id: "expired-1", createdAt: new Date(nowMs - 40 * DAY) });
    for (const auth of [undefined, "Bearer wrong-secret", "Bearer not-a-cron-token"]) {
      const headers: Record<string, string> = {};
      if (auth !== undefined) headers["authorization"] = auth;
      const res = await app.handle(
        new Request("http://localhost/api/v1/cron/evaluate-reminders", { headers }),
      );
      expect(res.status).toBe(401);
    }
    expect(auditStore.size).toBe(1);
    expect(auditStore.has("expired-1")).toBe(true);
  });

  test("F2. configured cron secret runs the purge server-side and keeps recent events", async () => {
    insertRow({ id: "expired-1", createdAt: new Date(nowMs - 40 * DAY) });
    insertRow({ id: "recent-1", createdAt: new Date(nowMs - 1 * DAY) });
    const res = await app.handle(
      new Request("http://localhost/api/v1/cron/evaluate-reminders", {
        headers: { authorization: "Bearer test-cron-secret" },
      }),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok?: boolean };
    expect(body.ok).toBe(true);
    expect(auditStore.has("expired-1")).toBe(false);
    expect(auditStore.has("recent-1")).toBe(true);
  });
});