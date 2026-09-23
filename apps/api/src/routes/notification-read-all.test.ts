/**
 * Finding #6 regression tests: `POST /api/v1/notifications/read-all`.
 *
 * The mock DB is a semantic fake: `tasks`/`notification_deliveries` live in
 * memory and the captured drizzle `where` conditions are EVALUATED against
 * those rows (small interpreter for the exact shapes this route builds —
 * `and` of `eq`/`isNull`/`inArray`-subquery, failing loudly on anything
 * else). Assertions on store state therefore prove what the real predicate
 * matches, and rendered-SQL assertions prove the predicate content
 * (ownership + `deletedAt IS NULL`).
 */
process.env.NODE_ENV = "test";
process.env.AUTH_BRIDGE_SECRET ??= "test-auth-bridge-secret";
import { beforeEach, describe, expect, mock, test } from "bun:test";
import { SQL } from "drizzle-orm";

import {
  createAuthorizationContext,
  setLoadAuthorizationContextOverride,
  type Capability,
} from "../lib/authorization";
import { setVerifyAccessTokenOverride } from "../lib/auth-tokens";

const USER_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const USER_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

type TaskRow = { id: string; userId: string; deletedAt: Date | null };
type DeliveryRow = {
  id: string;
  taskId: string;
  channel: string;
  status: string;
  readAt: Date | null;
};

let taskStore: TaskRow[] = [];
let deliveryStore: DeliveryRow[] = [];
const recordedSelectWheres: unknown[] = [];
let updateTerminalCalls = 0;
let selectLimitCalls = 0;

// DB column name → store key.
const KEY_BY_COLUMN: Record<string, string> = {
  id: "id",
  task_id: "taskId",
  channel: "channel",
  status: "status",
  read_at: "readAt",
  user_id: "userId",
  deleted_at: "deletedAt",
};

// ---------------------------------------------------------------------------
// Minimal predicate evaluator for the exact condition shapes built by the
// read-all route. Throws on unknown shapes instead of silently passing.
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

function flatText(node: unknown): string {
  if (node instanceof SQL) {
    return node.queryChunks.map((c) => flatText(c)).join("");
  }
  if (typeof node === "string") return node;
  if (node !== null && typeof node === "object") {
    const record = node as Record<string, unknown>;
    if (Array.isArray(record["value"])) {
      return (record["value"] as unknown[]).join("");
    }
    // Column → quoted identifier so content assertions see real names.
    if (typeof record["name"] === "string" && "table" in record) {
      return `"${record["name"]}"`;
    }
    if ("value" in record) return "?";
  }
  return "";
}

/** Split a top-level `and(...)` into operand chunk groups. */
function splitAnd(node: unknown): unknown[][] {
  const sql = node instanceof SQL ? node : null;
  if (!sql) throw new Error("expected SQL condition");
  let chunks: unknown[] = [...sql.queryChunks];
  // Unwrap single-child parenthesization: SQL["(", SQL, ")"].
  if (
    chunks.length === 3 &&
    chunks[1] instanceof SQL &&
    chunkText(chunks[0]).trim() === "(" &&
    chunkText(chunks[2]).trim() === ")"
  ) {
    chunks = [...(chunks[1] as SQL).queryChunks];
  }
  const groups: unknown[][] = [[]];
  for (const chunk of chunks) {
    if (
      chunk !== null &&
      typeof chunk === "object" &&
      !(
        chunk instanceof SQL ||
        ("table" in chunk && "name" in chunk) ||
        ("value" in chunk && !Array.isArray((chunk as { value: unknown }).value))
      ) &&
      chunkText(chunk).trim().toLowerCase() === "and"
    ) {
      groups.push([]);
    } else {
      groups[groups.length - 1].push(chunk);
    }
  }
  return groups;
}

function isColumnNode(node: unknown): node is { table: unknown; name: unknown } {
  return (
    node !== null &&
    typeof node === "object" &&
    !(node instanceof SQL) &&
    "table" in node &&
    "name" in node &&
    typeof (node as { name: unknown }).name === "string"
  );
}

function isParamNode(node: unknown): node is { value: unknown } {
  return (
    node !== null &&
    typeof node === "object" &&
    !(node instanceof SQL) &&
    "value" in node &&
    !Array.isArray((node as { value: unknown }).value) &&
    !("table" in node)
  );
}

function operandColumn(operand: unknown[]): { name: string } {
  const columns: string[] = [];
  const walk = (n: unknown): void => {
    if (n instanceof SQL) {
      for (const c of n.queryChunks) walk(c);
      return;
    }
    if (isColumnNode(n)) columns.push(n.name as string);
  };
  for (const c of operand) walk(c);
  if (columns.length === 0) throw new Error("no column in operand");
  return { name: columns[0] };
}

function operandParam(operand: unknown[]): unknown {
  let found: unknown;
  let count = 0;
  const walk = (n: unknown): void => {
    if (n instanceof SQL) {
      for (const c of n.queryChunks) walk(c);
      return;
    }
    if (isParamNode(n)) {
      count += 1;
      found = n.value;
    }
  };
  for (const c of operand) walk(c);
  if (count !== 1) throw new Error(`expected 1 param, got ${count}`);
  return found;
}

function cell(row: Record<string, unknown>, columnDbName: string): unknown {
  const key = KEY_BY_COLUMN[columnDbName];
  if (!key) throw new Error(`unknown column ${columnDbName}`);
  return row[key];
}

function evalOperand(
  operand: unknown[],
  scope: "deliveries" | "tasks",
  row: Record<string, unknown>,
): boolean {
  const text = operand.map((c) => flatText(c)).join("").toLowerCase();
  const column = operandColumn(operand).name;
  if (text.includes("is null")) {
    return cell(row, column) == null;
  }
  if (text.includes(" in ")) {
    if (scope !== "deliveries") throw new Error("in-subquery outside deliveries");
    if (recordedSelectWheres.length === 0) {
      throw new Error("no recorded subquery condition");
    }
    const inner =
      recordedSelectWheres[recordedSelectWheres.length - 1];
    const allowed = new Set(
      taskStore
        .filter((t) =>
          evalWhere(inner, "tasks", t as unknown as Record<string, unknown>),
        )
        .map((t) => t.id),
    );
    return allowed.has(cell(row, column) as string);
  }
  if (text.includes("=")) {
    return cell(row, column) === operandParam(operand);
  }
  throw new Error(`unsupported predicate: ${text}`);
}

function evalWhere(
  cond: unknown,
  scope: "deliveries" | "tasks",
  row: Record<string, unknown>,
): boolean {
  return splitAnd(cond).every((operand) => evalOperand(operand, scope, row));
}

// ---------------------------------------------------------------------------
// Mock DB: select chains record conditions; update evaluates the captured
// predicate against the in-memory store (single set-based statement).
// ---------------------------------------------------------------------------
function chain(op: "select" | "update") {
  const state: { where?: unknown; set?: { readAt?: Date | null } } = {};
  const self = {
    from: () => self,
    set: (v: { readAt?: Date | null }) => {
      state.set = v;
      return self;
    },
    where: (condition: unknown) => {
      state.where = condition;
      if (op === "select") recordedSelectWheres.push(condition);
      return self;
    },
    limit: async () => {
      selectLimitCalls += 1;
      return [];
    },
    returning: async () => {
      if (op !== "update" || state.where === undefined) return [];
      updateTerminalCalls += 1;
      const at = state.set?.readAt ?? null;
      const matched = deliveryStore.filter((d) =>
        evalWhere(state.where, "deliveries", d as unknown as Record<string, unknown>),
      );
      for (const row of matched) row.readAt = at;
      return matched.map((d) => ({ id: d.id }));
    },
  };
  return self;
}

mock.module("../lib/db", () => ({
  getDb: () => ({
    select: () => chain("select"),
    update: () => chain("update"),
  }),
}));

const { resetRateLimitBuckets } = await import("../plugins/rate-limit");
const { app } = await import("../app");

function authedAs(userId: string) {
  setVerifyAccessTokenOverride(async () => ({
    id: userId,
    email: `${userId}@example.com`,
    sessionId: "s",
  }));
  const capabilities: Capability[] = ["notification.mark-read"];
  setLoadAuthorizationContextOverride(async (subject) =>
    createAuthorizationContext({ subject, roles: ["user"], capabilities }),
  );
}

const TASK_A1 = "aaaaaaaa-0000-4000-8000-aaaaaaaaaaaa";
const TASK_A2 = "aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa";
const TASK_B1 = "bbbbbbbb-0000-4000-8000-bbbbbbbbbbbb";

function seedStore() {
  taskStore = [
    { id: TASK_A1, userId: USER_A, deletedAt: null },
    { id: TASK_A2, userId: USER_A, deletedAt: new Date("2026-01-01T00:00:00Z") },
    { id: TASK_B1, userId: USER_B, deletedAt: null },
  ];
  deliveryStore = [];
}

let seq = 0;
function addDelivery(
  taskId: string,
  readAt: Date | null = null,
  channel = "in_app",
  status = "sent",
): string {
  seq += 1;
  const id = `00000000-0000-4000-8000-${String(seq).padStart(12, "0")}`;
  deliveryStore.push({ id, taskId, channel, status, readAt });
  return id;
}

async function postReadAll(userId: string) {
  return app.handle(
    new Request("http://localhost/api/v1/notifications/read-all", {
      method: "POST",
      headers: { authorization: `Bearer ${userId === USER_A ? "a" : "b"}` },
    }),
  );
}

describe("finding #6 — read-all visibility and scale", () => {
  beforeEach(() => {
    resetRateLimitBuckets();
    recordedSelectWheres.length = 0;
    updateTerminalCalls = 0;
    selectLimitCalls = 0;
    seq = 0;
    seedStore();
    setVerifyAccessTokenOverride(null);
    setLoadAuthorizationContextOverride(null);
  });

  test("A. visible unread notifications become read", async () => {
    authedAs(USER_A);
    const n1 = addDelivery(TASK_A1);
    const n2 = addDelivery(TASK_A1);
    const n3 = addDelivery(TASK_A1);

    const response = await postReadAll(USER_A);
    expect(response.status).toBe(200);
    const body = (await response.json()) as { ok?: boolean; updated?: number };
    expect(body.ok).toBe(true);
    expect(body.updated).toBe(3);
    for (const id of [n1, n2, n3]) {
      expect(deliveryStore.find((d) => d.id === id)?.readAt).toBeInstanceOf(Date);
    }
  });

  test("B. deleted-task notifications stay unread with deletedAt intact", async () => {
    authedAs(USER_A);
    const visible = addDelivery(TASK_A1);
    const deleted = addDelivery(TASK_A2);

    const response = await postReadAll(USER_A);
    expect(response.status).toBe(200);
    const body = (await response.json()) as { ok?: boolean; updated?: number };
    expect(body.updated).toBe(1);
    expect(deliveryStore.find((d) => d.id === visible)?.readAt).toBeInstanceOf(Date);
    const untouched = deliveryStore.find((d) => d.id === deleted);
    expect(untouched?.readAt).toBeNull();
    expect(
      taskStore.find((t) => t.id === TASK_A2)?.deletedAt,
    ).toBeInstanceOf(Date);
  });

  test("C. cross-user isolation: B unchanged by A read-all", async () => {
    authedAs(USER_A);
    const own = addDelivery(TASK_A1);
    const other = addDelivery(TASK_B1);

    const response = await postReadAll(USER_A);
    expect(response.status).toBe(200);
    const body = (await response.json()) as { ok?: boolean; updated?: number };
    expect(body.updated).toBe(1);
    expect(deliveryStore.find((d) => d.id === own)?.readAt).toBeInstanceOf(Date);
    expect(deliveryStore.find((d) => d.id === other)?.readAt).toBeNull();
  });

  test("D. already-read notifications keep existing behavior", async () => {
    authedAs(USER_A);
    const oldRead = new Date("2026-02-02T00:00:00Z");
    const already = addDelivery(TASK_A1, oldRead);
    const fresh = addDelivery(TASK_A1);

    const response = await postReadAll(USER_A);
    expect(response.status).toBe(200);
    const body = (await response.json()) as { ok?: boolean; updated?: number };
    expect(body.updated).toBe(1);
    // Already-read row keeps its original timestamp (not re-stamped).
    expect(deliveryStore.find((d) => d.id === already)?.readAt).toBe(oldRead);
    expect(deliveryStore.find((d) => d.id === fresh)?.readAt).toBeInstanceOf(Date);
  });

  test("E. large volume: single statement, no ID loading, all visible read", async () => {
    authedAs(USER_A);
    const ids: string[] = [];
    for (let i = 0; i < 1200; i += 1) ids.push(addDelivery(TASK_A1));
    const deletedIds: string[] = [];
    for (let i = 0; i < 50; i += 1) deletedIds.push(addDelivery(TASK_A2));
    const otherIds: string[] = [];
    for (let i = 0; i < 30; i += 1) otherIds.push(addDelivery(TASK_B1));

    const response = await postReadAll(USER_A);
    expect(response.status).toBe(200);
    const body = (await response.json()) as { ok?: boolean; updated?: number };
    expect(body.updated).toBe(1200);
    // One UPDATE statement; notification IDs are never loaded into memory.
    expect(updateTerminalCalls).toBe(1);
    expect(selectLimitCalls).toBe(0);
    for (const id of ids) {
      expect(deliveryStore.find((d) => d.id === id)?.readAt).toBeInstanceOf(Date);
    }
    for (const id of [...deletedIds, ...otherIds]) {
      expect(deliveryStore.find((d) => d.id === id)?.readAt).toBeNull();
    }
  });

  test("predicate content: ownership + deletedAt-null + read conditions", async () => {
    authedAs(USER_A);
    addDelivery(TASK_A1);
    const response = await postReadAll(USER_A);
    expect(response.status).toBe(200);

    expect(recordedSelectWheres.length).toBe(1);
    const sub = flatText(recordedSelectWheres[0]).toLowerCase();
    expect(sub).toContain("user_id");
    expect(sub).toContain("deleted_at");
    expect(sub).toContain("is null");
  });
});
