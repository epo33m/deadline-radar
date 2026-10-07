/**
 * Finding #7 regression tests: idempotency check-then-insert race.
 *
 * The fake DB enforces the `unique (user_id, key)` scope and evaluates the
 * real captured drizzle conditions, so the claim logic runs exactly as in
 * production. Concurrency is made deterministic with a select gate: the
 * first lookup is held until the second lookup arrives, guaranteeing both
 * contenders observe the same empty state before either inserts — no timing
 * luck involved. Winner identity is never asserted, only the race properties
 * (one claim, one loser outcome, single side effect, single record).
 */
process.env.NODE_ENV = "test";
process.env.AUTH_BRIDGE_SECRET ??= "test-auth-bridge-secret";
import { beforeEach, describe, expect, mock, test } from "bun:test";
import { Param, SQL } from "drizzle-orm";
import { attachments, idempotencyKeys } from "@deadline-radar/db";

import {
  createAuthorizationContext,
  setLoadAuthorizationContextOverride,
  setOwnershipOverrides,
  type Capability,
} from "../authorization";
import { setVerifyAccessTokenOverride } from "../auth-tokens";
import { ApiError, API_ERROR_CODES } from "./errors";
import {
  beginIdempotent,
  completeIdempotent,
  purgeExpiredIdempotencyKeys,
  releaseIdempotent,
  releaseIdempotentOnClientError,
  DEFAULT_IN_FLIGHT_TIMEOUT_MS,
  getInFlightTimeoutMs,
} from "./idempotency";

const USER_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const USER_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const TASK_A = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

type IdemRow = {
  id?: string;
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

const idemStore = new Map<string, IdemRow>();
let attachmentInserts = 0;
let storageUploads = 0;
// I-02: fail the next N idempotencyKeys UPDATEs (complete path) once each.
let failCompleteCount = 0;
let completeUpdateCalls = 0;
// #136: fail the next N idempotencyKeys DELETEs (release path) once each.
let failIdemDeleteCount = 0;

// Select gate: holds the first lookup until the second arrives so both
// contenders deterministically observe the pre-insert state together.
let gateArmed = false;
let selectArrivals = 0;
let releaseFirstSelect: (() => void) | null = null;

// ---------------------------------------------------------------------------
// Condition evaluator for the exact shapes beginIdempotent builds.
// ---------------------------------------------------------------------------
function chunkText(chunk: unknown): string {
  if (typeof chunk === "string") return chunk;
  if (
    chunk !== null &&
    typeof chunk === "object" &&
    Array.isArray((chunk as { value?: unknown }).value)
  ) {
    return ((chunk as { value: unknown[] }).value as unknown[]).join("");
  }
  return "";
}

function unwrap(sql: SQL): unknown[] {
  let chunks: unknown[] = [...sql.queryChunks];
  for (;;) {
    if (
      chunks.length === 3 &&
      chunks[1] instanceof SQL &&
      chunkText(chunks[0]).trim() === "(" &&
      chunkText(chunks[2]).trim() === ")"
    ) {
      chunks = [...(chunks[1] as SQL).queryChunks];
      continue;
    }
    return chunks;
  }
}

function isColumnNode(node: unknown): node is { name: string } {
  if (node === null || typeof node !== "object" || node instanceof SQL) {
    return false;
  }
  const record = node as unknown as Record<string, unknown>;
  return "table" in record && typeof record["name"] === "string";
}

function splitOperands(chunks: unknown[]): unknown[][] {
  const groups: unknown[][] = [[]];
  for (const chunk of chunks) {
    if (
      !(chunk instanceof SQL) &&
      !isColumnNode(chunk) &&
      !(chunk instanceof Param) &&
      chunkText(chunk).trim().toLowerCase() === "and"
    ) {
      groups.push([]);
    } else {
      groups[groups.length - 1].push(chunk);
    }
  }
  return groups.filter((g) => g.length > 0);
}

function operandText(operand: unknown[]): string {
  return operand
    .map((c) => (c instanceof SQL ? unwrap(c).map(operandTextInner).join("") : chunkText(c)))
    .join("")
    .toLowerCase();
}

function operandTextInner(c: unknown): string {
  return c instanceof SQL
    ? unwrap(c).map(operandTextInner).join("")
    : chunkText(c);
}

function operandColumn(operand: unknown[]): string {
  const names: string[] = [];
  const walk = (n: unknown): void => {
    if (n instanceof SQL) {
      for (const c of n.queryChunks) walk(c);
      return;
    }
    if (isColumnNode(n)) names.push(n.name);
  };
  for (const c of operand) walk(c);
  if (names.length === 0) throw new Error("no column in operand");
  return names[0];
}

function operandValue(operand: unknown[]): unknown {
  let found: unknown;
  let count = 0;
  const walk = (n: unknown): void => {
    if (n instanceof SQL) {
      for (const c of n.queryChunks) walk(c);
      return;
    }
    if (n instanceof Param) {
      count += 1;
      found = (n as Param<unknown>).value as unknown;
    }
  };
  for (const c of operand) walk(c);
  if (count !== 1) throw new Error(`expected 1 param, got ${count}`);
  return found;
}

function operandValues(operand: unknown[]): unknown[] {
  const found: unknown[] = [];
  const walk = (n: unknown): void => {
    if (n instanceof SQL) {
      for (const c of n.queryChunks) walk(c);
      return;
    }
    if (n instanceof Param) {
      const val = (n as Param<unknown>).value;
      if (Array.isArray(val)) {
        found.push(...val);
      } else {
        found.push(val);
      }
      return;
    }
    if (Array.isArray(n)) {
      for (const c of n) walk(c);
    }
  };
  for (const c of operand) walk(c);
  return found;
}

const FIELD_BY_COLUMN: Record<string, keyof IdemRow> = {
  id: "id",
  user_id: "userId",
  key: "key",
  expires_at: "expiresAt",
  created_at: "createdAt",
  response_status: "responseStatus",
};

function compareValues(rowValue: unknown, param: unknown): number {
  const left = rowValue instanceof Date ? rowValue.getTime() : rowValue;
  const right = param instanceof Date ? param.getTime() : param;
  if (left === right) return 0;
  if (
    left !== null &&
    left !== undefined &&
    right !== null &&
    right !== undefined &&
    (left as number | string) > (right as number | string)
  ) {
    return 1;
  }
  return -1;
}

function operandMatches(operand: unknown[], row: IdemRow): boolean {
  const text = operandText(operand);
  const column = operandColumn(operand);
  const field = FIELD_BY_COLUMN[column];
  if (!field) throw new Error(`unknown column ${column}`);
  const cell = row[field];
  if (text.includes("is null")) return cell == null;
  if (text.includes("is not null")) return cell != null;
  if (
    /\bin\b/i.test(text) ||
    text.includes("in (") ||
    text.includes("in(") ||
    operandValues(operand).length > 1
  ) {
    const vals = operandValues(operand);
    return vals.some((v) => compareValues(cell, v) === 0);
  }
  if (text.includes("<=")) return compareValues(cell, operandValue(operand)) <= 0;
  if (text.includes(">")) return compareValues(cell, operandValue(operand)) > 0;
  if (text.includes("=")) return compareValues(cell, operandValue(operand)) === 0;
  throw new Error(`unsupported predicate: ${text}`);
}

function whereMatches(where: unknown, row: IdemRow): boolean {
  if (!(where instanceof SQL)) throw new Error("expected SQL where");
  return splitOperands(unwrap(where)).every((op) => operandMatches(op, row));
}

function matchingRows(where: unknown): IdemRow[] {
  return [...idemStore.values()].filter((row) => whereMatches(where, row));
}

// ---------------------------------------------------------------------------
// Fake DB
// ---------------------------------------------------------------------------
function chain(op: "select" | "insert" | "update" | "delete", table?: unknown) {
  const state: {
    where?: unknown;
    values?: Record<string, unknown>;
    set?: Record<string, unknown>;
    ignoreConflict?: boolean;
  } = {};
  const self = {
    from: () => self,
    set: (v: Record<string, unknown>) => {
      state.set = v;
      return self;
    },
    values: (v: Record<string, unknown>) => {
      state.values = v;
      return self;
    },
    where: (condition: unknown) => {
      state.where = condition;
      return self;
    },
    onConflictDoNothing: () => {
      state.ignoreConflict = true;
      return self;
    },
    limit: async (n?: number) => {
      if (op === "select" && gateArmed) {
        selectArrivals += 1;
        if (selectArrivals === 1) {
          await new Promise<void>((resolve) => {
            releaseFirstSelect = resolve;
          });
        } else if (selectArrivals === 2) {
          const release = releaseFirstSelect;
          releaseFirstSelect = null;
          release?.();
        }
      }
      if (op === "select") {
        const count = typeof n === "number" ? n : 1;
        return state.where === undefined ? [] : matchingRows(state.where).slice(0, count);
      }
      return [];
    },
    returning: async () => {
      if (op === "insert" && table === idempotencyKeys) {
        const v = state.values as unknown as IdemRow;
        const mapKey = `${v.userId}:${v.key}`;
        if (idemStore.has(mapKey)) {
          if (!state.ignoreConflict) throw new Error("duplicate key");
          return [];
        }
        const row: IdemRow = {
          id: v.id ?? `id-${v.userId}-${v.key}`,
          ...v,
          createdAt: v.createdAt ?? new Date(),
          responseStatus: null,
          responseBody: null,
        };
        idemStore.set(mapKey, row);
        return [row];
      }
      if (op === "insert" && table === attachments) {
        attachmentInserts += 1;
        return [
          {
            id: "11111111-1111-4111-8111-111111111111",
            taskId: TASK_A,
            type: "file",
            notes: null,
            storagePath: `attachments/${USER_A}/${TASK_A}/doc.pdf`,
            url: null,
            createdAt: new Date(),
          },
        ];
      }
      if (op === "delete" && table === idempotencyKeys) {
        if (failIdemDeleteCount > 0) {
          failIdemDeleteCount -= 1;
          throw new Error("fake db: idem delete failed");
        }
        const matched =
          state.where === undefined ? [] : matchingRows(state.where);
        for (const row of matched) {
          idemStore.delete(`${row.userId}:${row.key}`);
        }
        return matched.map((row) => ({ id: row.id ?? row.key }));
      }
      if (op === "update" && table === idempotencyKeys) {
        completeUpdateCalls += 1;
        if (failCompleteCount > 0) {
          failCompleteCount -= 1;
          throw new Error("fake db: complete update failed");
        }
        if (state.where !== undefined) {
          for (const row of matchingRows(state.where)) {
            if (state.set && "responseStatus" in state.set) {
              row.responseStatus = state.set["responseStatus"] as number;
            }
            if (state.set && "responseBody" in state.set) {
              row.responseBody = state.set["responseBody"];
            }
          }
        }
        return [];
      }
      return [];
    },
    then: (
      resolve: (v: unknown) => unknown,
      reject?: (e: unknown) => unknown,
    ) => {
      const run = async (): Promise<unknown> => {
        if (op === "insert" && table === idempotencyKeys) {
          const v = state.values as unknown as IdemRow;
          const mapKey = `${v.userId}:${v.key}`;
          if (idemStore.has(mapKey)) {
            if (!state.ignoreConflict) throw new Error("duplicate key");
            return [];
          }
          const row: IdemRow = {
            id: v.id ?? `id-${v.userId}-${v.key}`,
            ...v,
            createdAt: v.createdAt ?? new Date(),
            responseStatus: null,
            responseBody: null,
          };
          idemStore.set(mapKey, row);
          return [row];
        }
        if (op === "delete" && table === idempotencyKeys) {
          if (failIdemDeleteCount > 0) {
            failIdemDeleteCount -= 1;
            throw new Error("fake db: idem delete failed");
          }
          const matched =
            state.where === undefined ? [] : matchingRows(state.where);
          for (const row of matched) {
            idemStore.delete(`${row.userId}:${row.key}`);
          }
          return [];
        }
        if (op === "update" && table === idempotencyKeys) {
          completeUpdateCalls += 1;
          if (failCompleteCount > 0) {
            failCompleteCount -= 1;
            throw new Error("fake db: complete update failed");
          }
          if (state.where !== undefined) {
            for (const row of matchingRows(state.where)) {
              if (state.set && "responseStatus" in state.set) {
                row.responseStatus = state.set["responseStatus"] as number;
              }
              if (state.set && "responseBody" in state.set) {
                row.responseBody = state.set["responseBody"];
              }
            }
          }
          return [];
        }
        if (op === "update") {
          if (state.where !== undefined) {
            for (const row of matchingRows(state.where)) {
              if (state.set && "responseStatus" in state.set) {
                row.responseStatus = state.set["responseStatus"] as number;
              }
              if (state.set && "responseBody" in state.set) {
                row.responseBody = state.set["responseBody"];
              }
            }
          }
          return [];
        }
        if (op === "select") {
          return state.where === undefined ? [] : matchingRows(state.where);
        }
        return [];
      };
      return run().then(resolve, reject);
    },
  };
  return self;
}

mock.module("../db", () => ({
  getDb: () => {
    const db: any = {
      select: () => chain("select"),
      insert: (table: unknown) => chain("insert", table),
      update: (table: unknown) => chain("update", table),
      delete: (table: unknown) => chain("delete", table),
      // #137: the upload route now runs insert+completion inside withUserRls.
      execute: async () => [],
      transaction: (cb: (tx: unknown) => unknown) => cb(db),
    };
    return db;
  },
}));

mock.module("../auth-audit", () => ({
  recordAuthEvent: async () => undefined,
}));

mock.module("../supabase", () => ({
  createAnonClient: () => ({ auth: {} }),
  createUserClient: () => ({ auth: {} }),
  createServiceClient: () => ({
    storage: {
      from: () => ({
        upload: async (key: string) => {
          storageUploads += 1;
          return { data: { path: key }, error: null };
        },
        remove: async () => ({ data: [], error: null }),
        createSignedUrl: async () => ({ data: null, error: null }),
      }),
    },
  }),
}));

const { resetRateLimitBuckets } = await import("../../plugins/rate-limit");
const { app } = await import("../../app");

const TASK_ROW = {
  id: TASK_A,
  userId: USER_A,
  courseId: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
  title: "Task",
  description: null,
  deadline: new Date("2026-10-01T00:00:00Z"),
  status: "todo" as const,
  completedAt: null,
  createdAt: new Date(),
  updatedAt: new Date(),
  deadlineUpdatedAt: new Date(),
  deletedAt: null,
  idempotencyKey: null,
};

function authed(userId: string, capabilities: Capability[]) {
  setVerifyAccessTokenOverride(async () => ({
    id: userId,
    email: `${userId}@example.com`,
    sessionId: "s",
  }));
  setLoadAuthorizationContextOverride(async (subject) =>
    createAuthorizationContext({ subject, roles: ["user"], capabilities }),
  );
  setOwnershipOverrides({
    ownedTask: async (uid, taskId) =>
      uid === USER_A && taskId === TASK_A ? { ...TASK_ROW } : null,
  });
}

type BeginResult =
  | { ok: true; replay: unknown }
  | { ok: false; error: unknown };

async function tryBegin(
  userId: string,
  key: string,
  body: unknown,
): Promise<BeginResult> {
  try {
    const { replay } = await beginIdempotent({
      userId,
      key,
      method: "POST",
      path: "/api/v1/attachments/file",
      body,
    });
    return { ok: true, replay };
  } catch (error) {
    return { ok: false, error };
  }
}

function uploadRequest(content: string, key: string, userId: string) {
  const form = new FormData();
  form.set("task_id", TASK_A);
  form.set(
    "file",
    new File([content], "doc.pdf", { type: "application/pdf" }),
  );
  return app.handle(
    new Request("http://localhost/api/v1/attachments/file", {
      method: "POST",
      headers: {
        authorization: `Bearer ${userId === USER_A ? "a" : "b"}`,
        "idempotency-key": key,
      },
      body: form,
    }),
  );
}

describe("finding #7 & M-7 — idempotency race, stale recovery & cleanup", () => {
  beforeEach(() => {
    resetRateLimitBuckets();
    idemStore.clear();
    attachmentInserts = 0;
    storageUploads = 0;
    failCompleteCount = 0;
    completeUpdateCalls = 0;
    gateArmed = false;
    selectArrivals = 0;
    releaseFirstSelect = null;
    setVerifyAccessTokenOverride(null);
    setLoadAuthorizationContextOverride(null);
    setOwnershipOverrides(null);
  });

  test("A. concurrent same key + same fingerprint: one claim, loser 409, single record", async () => {
    gateArmed = true;
    const body = { task_id: TASK_A, size: 10 };
    const [first, second] = await Promise.all([
      tryBegin(USER_A, "race-key-a", body),
      tryBegin(USER_A, "race-key-a", body),
    ]);
    gateArmed = false;

    const winner = first.ok ? first : second;
    const loser = first.ok ? second : first;
    expect(winner.ok).toBe(true);
    expect(loser.ok).toBe(false);
    if (!loser.ok) {
      expect(loser.error).toBeInstanceOf(ApiError);
      expect((loser.error as ApiError).code).toBe(API_ERROR_CODES.CONFLICT);
    }
    expect(idemStore.size).toBe(1);
  });

  test("B. concurrent same key + different fingerprint: one wins, other 409 mismatch", async () => {
    gateArmed = true;
    const [first, second] = await Promise.all([
      tryBegin(USER_A, "race-key-b", { n: 1 }),
      tryBegin(USER_A, "race-key-b", { n: 2 }),
    ]);
    gateArmed = false;

    const winner = first.ok ? first : second;
    const loser = first.ok ? second : first;
    expect(winner.ok).toBe(true);
    expect(loser.ok).toBe(false);
    if (!loser.ok) {
      expect(loser.error).toBeInstanceOf(ApiError);
      expect((loser.error as ApiError).code).toBe(
        API_ERROR_CODES.IDEMPOTENCY_CONFLICT,
      );
    }
    expect(idemStore.size).toBe(1);
  });

  test("C. different users share a key independently", async () => {
    const [forA, forB] = await Promise.all([
      tryBegin(USER_A, "shared-key", { n: 1 }),
      tryBegin(USER_B, "shared-key", { n: 1 }),
    ]);
    expect(forA.ok).toBe(true);
    expect(forB.ok).toBe(true);
    expect(idemStore.size).toBe(2);
  });

  test("D. expired record is reclaimed, never replayed stale", async () => {
    idemStore.set(`${USER_A}:old-key`, {
      id: "old-key-id",
      userId: USER_A,
      key: "old-key",
      method: "POST",
      path: "/api/v1/attachments/file",
      requestHash: "stale-hash",
      responseStatus: 200,
      responseBody: { stale: true },
      createdAt: new Date(Date.now() - 25 * 60 * 60 * 1000),
      expiresAt: new Date(Date.now() - 1000),
    });

    const fresh = await tryBegin(USER_A, "old-key", { n: "new" });
    expect(fresh.ok).toBe(true);
    if (fresh.ok) {
      // Fresh claim, not a replay of the lapsed response.
      expect(fresh.replay).toBeNull();
    }
    expect(idemStore.size).toBe(1);
    const row = idemStore.get(`${USER_A}:old-key`);
    expect(row?.responseStatus).toBeNull();
    expect(row?.expiresAt.getTime()).toBeGreaterThan(Date.now());
  });

  test("E. failed operation leaves in-flight claim, retried within timeout returns 409 conflict", async () => {
    const claimed = await tryBegin(USER_A, "fail-key", { n: 1 });
    expect(claimed.ok).toBe(true);
    // Side effect fails → completeIdempotent never runs:
    // in-flight row with createdAt = now
    expect(idemStore.size).toBe(1);
    const retry = await tryBegin(USER_A, "fail-key", { n: 1 });
    expect(retry.ok).toBe(false);
    if (!retry.ok) {
      expect((retry.error as ApiError).code).toBe(API_ERROR_CODES.CONFLICT);
      expect((retry.error as ApiError).message).toBe(
        "Idempotent request already in progress",
      );
    }
    const row = idemStore.get(`${USER_A}:fail-key`);
    expect(row?.responseStatus).toBeNull();
    expect(row?.responseBody).toBeNull();
  });

  test("M-7 A: Normal success & completed replay", async () => {
    const beginRes = await beginIdempotent({
      userId: USER_A,
      key: "normal-key",
      method: "POST",
      path: "/api/v1/tasks",
      body: { title: "Task 1" },
    });
    expect(beginRes.replay).toBeNull();

    await completeIdempotent({
      userId: USER_A,
      key: "normal-key",
      statusCode: 200,
      body: { task: { id: "task-123", title: "Task 1" } },
    });

    const replayRes = await beginIdempotent({
      userId: USER_A,
      key: "normal-key",
      method: "POST",
      path: "/api/v1/tasks",
      body: { title: "Task 1" },
    });
    expect(replayRes.replay).toEqual({
      statusCode: 200,
      body: { task: { id: "task-123", title: "Task 1" } },
    });
  });

  test("M-7 B: Stale in-flight recovery after timeout", async () => {
    const timeoutMs = getInFlightTimeoutMs();

    // 1. Set an in-flight row that was created in the past (beyond in-flight timeout)
    const staleCreatedAt = new Date(Date.now() - timeoutMs - 5000);
    const futureExpiresAt = new Date(Date.now() + 20 * 60 * 60 * 1000);

    const { hashRequestFingerprint } = await import("./idempotency");
    const fingerprint = hashRequestFingerprint(
      "POST",
      "/api/v1/attachments/file",
      { n: 1 },
    );

    idemStore.set(`${USER_A}:stale-key`, {
      id: "stale-row-id",
      userId: USER_A,
      key: "stale-key",
      method: "POST",
      path: "/api/v1/attachments/file",
      requestHash: fingerprint,
      responseStatus: null,
      responseBody: null,
      createdAt: staleCreatedAt,
      expiresAt: futureExpiresAt,
    });

    // 2. Retry with same key & fingerprint: since it timed out, it should be reclaimed atomically
    const recovery = await tryBegin(USER_A, "stale-key", { n: 1 });
    expect(recovery.ok).toBe(true);
    if (recovery.ok) {
      expect(recovery.replay).toBeNull();
    }

    // 3. New record is in-flight with fresh createdAt
    const row = idemStore.get(`${USER_A}:stale-key`);
    expect(row).toBeDefined();
    expect(row?.responseStatus).toBeNull();
    expect(row?.createdAt.getTime()).toBeGreaterThan(staleCreatedAt.getTime());
  });

  test("M-7 C: Concurrent recovery race on stale in-flight row yields one winner", async () => {
    const timeoutMs = getInFlightTimeoutMs();
    const staleCreatedAt = new Date(Date.now() - timeoutMs - 5000);
    const futureExpiresAt = new Date(Date.now() + 20 * 60 * 60 * 1000);

    const { hashRequestFingerprint } = await import("./idempotency");
    const fingerprint = hashRequestFingerprint(
      "POST",
      "/api/v1/attachments/file",
      { n: 1 },
    );

    idemStore.set(`${USER_A}:stale-race-key`, {
      id: "stale-race-id",
      userId: USER_A,
      key: "stale-race-key",
      method: "POST",
      path: "/api/v1/attachments/file",
      requestHash: fingerprint,
      responseStatus: null,
      responseBody: null,
      createdAt: staleCreatedAt,
      expiresAt: futureExpiresAt,
    });

    gateArmed = true;
    const [first, second] = await Promise.all([
      tryBegin(USER_A, "stale-race-key", { n: 1 }),
      tryBegin(USER_A, "stale-race-key", { n: 1 }),
    ]);
    gateArmed = false;

    const winner = first.ok ? first : second;
    const loser = first.ok ? second : first;
    expect(winner.ok).toBe(true);
    expect(loser.ok).toBe(false);
    if (!loser.ok) {
      expect(loser.error).toBeInstanceOf(ApiError);
      expect((loser.error as ApiError).code).toBe(API_ERROR_CODES.CONFLICT);
    }
    expect(idemStore.size).toBe(1);
  });

  test("M-7 D: Expired row purge deletes only expired rows and is idempotent", async () => {
    const now = new Date();
    const past1 = new Date(now.getTime() - 60 * 1000);
    const past2 = new Date(now.getTime() - 3600 * 1000);
    const future = new Date(now.getTime() + 3600 * 1000);

    // 2 expired rows (one completed, one in-flight)
    idemStore.set(`${USER_A}:exp-1`, {
      id: "exp-1-id",
      userId: USER_A,
      key: "exp-1",
      method: "POST",
      path: "/api/v1/tasks",
      requestHash: "hash-1",
      responseStatus: 200,
      responseBody: {},
      createdAt: new Date(past2.getTime() - 86400 * 1000),
      expiresAt: past1,
    });
    idemStore.set(`${USER_A}:exp-2`, {
      id: "exp-2-id",
      userId: USER_A,
      key: "exp-2",
      method: "POST",
      path: "/api/v1/tasks",
      requestHash: "hash-2",
      responseStatus: null,
      responseBody: null,
      createdAt: new Date(past2.getTime() - 86400 * 1000),
      expiresAt: past2,
    });

    // 2 active rows (one completed, one in-flight)
    idemStore.set(`${USER_A}:active-1`, {
      id: "active-1-id",
      userId: USER_A,
      key: "active-1",
      method: "POST",
      path: "/api/v1/tasks",
      requestHash: "hash-3",
      responseStatus: 200,
      responseBody: {},
      createdAt: now,
      expiresAt: future,
    });
    idemStore.set(`${USER_A}:active-2`, {
      id: "active-2-id",
      userId: USER_A,
      key: "active-2",
      method: "POST",
      path: "/api/v1/tasks",
      requestHash: "hash-4",
      responseStatus: null,
      responseBody: null,
      createdAt: now,
      expiresAt: future,
    });

    expect(idemStore.size).toBe(4);

    // Run purge
    const deletedCount = await purgeExpiredIdempotencyKeys({ now });
    expect(deletedCount).toBe(2);
    expect(idemStore.size).toBe(2);
    expect(idemStore.has(`${USER_A}:exp-1`)).toBe(false);
    expect(idemStore.has(`${USER_A}:exp-2`)).toBe(false);
    expect(idemStore.has(`${USER_A}:active-1`)).toBe(true);
    expect(idemStore.has(`${USER_A}:active-2`)).toBe(true);

    // Repeated run is a safe no-op returning 0
    const secondRun = await purgeExpiredIdempotencyKeys({ now });
    expect(secondRun).toBe(0);
    expect(idemStore.size).toBe(2);
  });

  test("M-7 E: Stale in-flight key reused with different fingerprint throws IDEMPOTENCY_CONFLICT", async () => {
    const timeoutMs = getInFlightTimeoutMs();
    const staleCreatedAt = new Date(Date.now() - timeoutMs - 5000);
    const futureExpiresAt = new Date(Date.now() + 20 * 60 * 60 * 1000);

    const { hashRequestFingerprint } = await import("./idempotency");
    const fingerprint = hashRequestFingerprint(
      "POST",
      "/api/v1/attachments/file",
      { original: true },
    );

    idemStore.set(`${USER_A}:stale-diff-key`, {
      id: "stale-diff-id",
      userId: USER_A,
      key: "stale-diff-key",
      method: "POST",
      path: "/api/v1/attachments/file",
      requestHash: fingerprint,
      responseStatus: null,
      responseBody: null,
      createdAt: staleCreatedAt,
      expiresAt: futureExpiresAt,
    });

    const diffAttempt = await tryBegin(USER_A, "stale-diff-key", {
      different: true,
    });
    expect(diffAttempt.ok).toBe(false);
    if (!diffAttempt.ok) {
      expect(diffAttempt.error).toBeInstanceOf(ApiError);
      expect((diffAttempt.error as ApiError).code).toBe(
        API_ERROR_CODES.IDEMPOTENCY_CONFLICT,
      );
    }
  });

  test("M-7 F: Opportunistic purge failure containment", async () => {
    const { maybeTriggerOpportunisticPurge, resetOpportunisticPurgeThrottle } =
      await import("./idempotency");
    resetOpportunisticPurgeThrottle();

    // Does not throw even if background purge encounters error
    expect(() => {
      maybeTriggerOpportunisticPurge();
    }).not.toThrow();
  });

  test("route: concurrent uploads run the side effect exactly once", async () => {
    authed(USER_A, ["attachment.create"]);
    gateArmed = true;
    const [first, second] = await Promise.all([
      uploadRequest("%PDF-1.4\nconcurrent", "route-race-key", USER_A),
      uploadRequest("%PDF-1.4\nconcurrent", "route-race-key", USER_A),
    ]);
    gateArmed = false;

    const statuses = [first.status, second.status].sort();
    expect(statuses).toEqual([200, 409]);
    expect(storageUploads).toBe(1);
    expect(attachmentInserts).toBe(1);
    expect(idemStore.size).toBe(1);
  });
});

describe("I-02 — complete-after-commit gap", () => {
  beforeEach(() => {
    resetRateLimitBuckets();
    idemStore.clear();
    attachmentInserts = 0;
    storageUploads = 0;
    failCompleteCount = 0;
    completeUpdateCalls = 0;
    gateArmed = false;
    selectArrivals = 0;
    releaseFirstSelect = null;
    setVerifyAccessTokenOverride(null);
    setLoadAuthorizationContextOverride(null);
    setOwnershipOverrides(null);
  });

  const OPTS = {
    userId: USER_A,
    key: "complete-key",
    method: "POST",
    path: "/api/v1/attachments/file",
    body: { task_id: TASK_A, size: 10 },
  };

  test("transient complete failure is retried bounded, then succeeds", async () => {
    await beginIdempotent(OPTS);
    failCompleteCount = 2;

    const completed = await completeIdempotent({
      userId: USER_A,
      key: OPTS.key,
      statusCode: 200,
      body: { ok: true },
    });

    expect(completed).toBe(true);
    // 2 failures + 1 success = bounded, not once and not unbounded.
    expect(completeUpdateCalls).toBe(3);
    expect(idemStore.get(`${USER_A}:${OPTS.key}`)?.responseStatus).toBe(200);
  });

  test("persistent complete failure never throws: same-key retry creates no second row", async () => {
    await beginIdempotent(OPTS);
    failCompleteCount = 99;

    const completed = await completeIdempotent({
      userId: USER_A,
      key: OPTS.key,
      statusCode: 200,
      body: { ok: true },
    });

    // No throw (caller serves the already-committed success response).
    expect(completed).toBe(false);
    expect(completeUpdateCalls).toBe(3);
    // The key row still exists exactly once — no duplicate side effect row.
    expect(idemStore.size).toBe(1);
    // Immediate retry with the same key+body: in-flight 409, still one row.
    const retry = await tryBegin(USER_A, OPTS.key, OPTS.body);
    expect(retry.ok).toBe(false);
    if (!retry.ok) {
      expect(retry.error).toBeInstanceOf(ApiError);
      expect((retry.error as ApiError).status).toBe(409);
    }
    expect(idemStore.size).toBe(1);
  });

  test("fingerprint mismatch still 409 even when the key never completed", async () => {
    await beginIdempotent(OPTS);
    failCompleteCount = 99;
    await completeIdempotent({
      userId: USER_A,
      key: OPTS.key,
      statusCode: 200,
      body: { ok: true },
    });

    const mismatch = await tryBegin(USER_A, OPTS.key, { different: true });
    expect(mismatch.ok).toBe(false);
    if (!mismatch.ok) {
      expect(mismatch.error).toBeInstanceOf(ApiError);
      expect((mismatch.error as ApiError).code).toBe(
        API_ERROR_CODES.IDEMPOTENCY_CONFLICT,
      );
    }
    expect(idemStore.size).toBe(1);
  });
});

describe("#136 — release our own uncompleted claim on 4xx", () => {
  beforeEach(() => {
    resetRateLimitBuckets();
    idemStore.clear();
    attachmentInserts = 0;
    storageUploads = 0;
    failCompleteCount = 0;
    completeUpdateCalls = 0;
    failIdemDeleteCount = 0;
    gateArmed = false;
    selectArrivals = 0;
    releaseFirstSelect = null;
    setVerifyAccessTokenOverride(null);
    setLoadAuthorizationContextOverride(null);
    setOwnershipOverrides(null);
  });

  const OPTS = {
    userId: USER_A,
    key: "release-key",
    method: "POST",
    path: "/api/v1/attachments/file",
    body: { task_id: TASK_A, size: 10 },
  };

  test("deletes the uncompleted claim so the same key can be retried", async () => {
    await beginIdempotent(OPTS);
    expect(idemStore.size).toBe(1);

    await releaseIdempotent({ userId: USER_A, key: OPTS.key });

    expect(idemStore.size).toBe(0);
    const retry = await tryBegin(USER_A, OPTS.key, { corrected: true });
    expect(retry.ok).toBe(true);
    expect(idemStore.size).toBe(1);
  });

  test("completed claim survives release (replay still governs)", async () => {
    await beginIdempotent(OPTS);
    await completeIdempotent({
      userId: USER_A,
      key: OPTS.key,
      statusCode: 200,
      body: { ok: true },
    });

    await releaseIdempotent({ userId: USER_A, key: OPTS.key });

    expect(idemStore.get(`${USER_A}:${OPTS.key}`)?.responseStatus).toBe(200);
    const replay = await tryBegin(USER_A, OPTS.key, OPTS.body);
    expect(replay.ok).toBe(true);
    if (replay.ok) {
      expect(replay.replay).toEqual({ statusCode: 200, body: { ok: true } });
    }
  });

  test("release is scoped to the caller's own key", async () => {
    await beginIdempotent({ ...OPTS, userId: USER_B });

    await releaseIdempotent({ userId: USER_A, key: OPTS.key });

    expect(idemStore.size).toBe(1);
  });

  test("release failures are contained (never throw)", async () => {
    await beginIdempotent(OPTS);
    failIdemDeleteCount = 1;
    const logged: unknown[][] = [];
    const original = console.error;
    console.error = (...args: unknown[]) => {
      logged.push(args);
    };
    try {
      await releaseIdempotent({ userId: USER_A, key: OPTS.key });
    } finally {
      console.error = original;
    }

    expect(idemStore.size).toBe(1);
    expect(logged.length).toBe(1);
  });

  test("releaseIdempotentOnClientError frees only definitive 4xx claims", async () => {
    await beginIdempotent(OPTS);

    await releaseIdempotentOnClientError(
      new ApiError({
        status: 500,
        code: API_ERROR_CODES.INTERNAL,
        message: "boom",
      }),
      { userId: USER_A, key: OPTS.key },
    );
    expect(idemStore.size).toBe(1);

    await releaseIdempotentOnClientError(new Error("transport"), {
      userId: USER_A,
      key: OPTS.key,
    });
    await releaseIdempotentOnClientError(null, {
      userId: USER_A,
      key: OPTS.key,
    });
    expect(idemStore.size).toBe(1);

    await releaseIdempotentOnClientError(ApiError.validation("bad body"), {
      userId: USER_A,
      key: OPTS.key,
    });
    expect(idemStore.size).toBe(0);
  });

  test("releaseIdempotentOnClientError is a no-op without a key", async () => {
    await beginIdempotent(OPTS);

    await releaseIdempotentOnClientError(ApiError.validation("bad body"), {
      userId: USER_A,
      key: null,
    });

    expect(idemStore.size).toBe(1);
  });
});

