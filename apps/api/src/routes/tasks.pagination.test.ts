/**
 * F-6 route pagination contract: limit/cursor traversal + filter combos.
 *
 * Unit tests (pagination.test.ts) cover the cursor codec; this file proves
 * the ROUTES honor it: limit/cursor → nextCursor → next page envelope,
 * sort+courseId combos, and tenant scoping of every page. The mock DB is a
 * semantic fake in the notification-read-all.test.ts tradition: captured
 * drizzle conditions are EVALUATED against in-memory stores (supports the
 * exact shapes the list routes build: and/or/eq/gt/lt/isNull + asc/desc
 * orderBy + limit slicing, failing loudly on anything else).
 *
 * What is deliberately NOT covered: id tie-break ordering (lexicographic
 * UUID comparison in the fake matches PG byte order for canonical lowercase
 * UUIDs, but no fixture shares a sort key — the codec edge is unit-tested).
 */
process.env.NODE_ENV = "test";
process.env.AUTH_BRIDGE_SECRET ??= "test-auth-bridge-secret";
import { beforeEach, describe, expect, mock, test } from "bun:test";
import { SQL } from "drizzle-orm";
import { courses, tasks } from "@deadline-radar/db";

import {
  createAuthorizationContext,
  setLoadAuthorizationContextOverride,
  type Capability,
} from "../lib/authorization";
import { setVerifyAccessTokenOverride } from "../lib/auth-tokens";
import { resetRateLimitBuckets } from "../plugins/rate-limit";

const USER_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const USER_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const COURSE_A = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const COURSE_B = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";

// Deadlines ascending T1 < T2 < T3; createdAt ascending T3 < T1 < T2 so the
// sort=createdAt combo provably differs from deadline order.
const T1 = "11111111-1111-4111-8111-111111111111";
const T2 = "22222222-2222-4222-8222-222222222222";
const T3 = "33333333-3333-4333-8333-333333333333";
const TB = "bbbbbbbb-0000-4000-8000-bbbbbbbbbbbb";
const TD = "dddddddd-0000-4000-8000-dddddddddddd";

type TaskRow = {
  id: string;
  userId: string;
  courseId: string;
  title: string;
  description: string | null;
  deadline: Date;
  status: string;
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
};

type CourseRow = {
  id: string;
  userId: string;
  name: string;
  code: string | null;
  color: string | null;
  icon: string | null;
  description: string | null;
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
};

let taskStore: TaskRow[] = [];
let courseStore: CourseRow[] = [];

function seedStores() {
  courseStore = [
    {
      id: COURSE_A, userId: USER_A, name: "Course A", code: null, color: null,
      icon: null, description: null, createdAt: new Date("2026-09-01T00:00:00Z"),
      updatedAt: new Date("2026-09-01T00:00:00Z"), deletedAt: null,
    },
    {
      id: COURSE_B, userId: USER_A, name: "Course B", code: null, color: null,
      icon: null, description: null, createdAt: new Date("2026-09-05T00:00:00Z"),
      updatedAt: new Date("2026-09-05T00:00:00Z"), deletedAt: null,
    },
  ];
  const mk = (
    id: string, userId: string, courseId: string, title: string,
    deadline: string, createdAt: string, deletedAt: string | null = null,
  ): TaskRow => ({
    id, userId, courseId, title, description: null,
    deadline: new Date(deadline), status: "todo",
    createdAt: new Date(createdAt), updatedAt: new Date(createdAt),
    deletedAt: deletedAt ? new Date(deletedAt) : null,
  });
  taskStore = [
    mk(T1, USER_A, COURSE_A, "T1", "2026-12-01T09:00:00Z", "2026-09-03T00:00:00Z"),
    mk(T2, USER_A, COURSE_B, "T2", "2026-12-05T09:00:00Z", "2026-09-04T00:00:00Z"),
    mk(T3, USER_A, COURSE_A, "T3", "2026-12-10T09:00:00Z", "2026-09-01T00:00:00Z"),
    mk(TB, USER_B, COURSE_B, "TB", "2026-12-03T09:00:00Z", "2026-09-01T00:00:00Z"),
    mk(TD, USER_A, COURSE_A, "TD", "2026-12-02T09:00:00Z", "2026-09-01T00:00:00Z", "2026-10-01T00:00:00Z"),
  ];
}

// ---------------------------------------------------------------------------
// Predicate evaluator (strict: unknown shapes throw).
// ---------------------------------------------------------------------------
function chunkText(chunk: unknown): string {
  if (typeof chunk === "string") return chunk;
  if (chunk !== null && typeof chunk === "object") {
    const r = chunk as Record<string, unknown>;
    if (Array.isArray(r["value"])) return (r["value"] as unknown[]).join("");
    // Column → quoted identifier so content assertions see real names.
    if (typeof r["name"] === "string" && "table" in r) {
      return `"${r["name"]}"`;
    }
    if ("value" in r) return "?";
  }
  return "";
}

function flatText(node: unknown): string {
  if (node instanceof SQL) return node.queryChunks.map(flatText).join("");
  return chunkText(node);
}

function splitTopLevel(node: unknown, keyword: "and" | "or"): unknown[][] {
  const sql = node instanceof SQL ? node : null;
  if (!sql) throw new Error(`expected SQL for ${keyword}`);
  let chunks: unknown[] = [...sql.queryChunks];
  if (
    chunks.length === 3 &&
    chunks[1] instanceof SQL &&
    chunkText(chunks[0]).trim() === "(" &&
    chunkText(chunks[2]).trim() === ")"
  ) {
    chunks = [...(chunks[1] as SQL).queryChunks];
  }
  return splitChunks(chunks, keyword);
}

function splitChunks(chunks: unknown[], keyword: "and" | "or"): unknown[][] {
  const groups: unknown[][] = [[]];
  for (const chunk of chunks) {
    const text = chunk instanceof SQL ? "" : chunkText(chunk).trim().toLowerCase();
    if (text === keyword) {
      groups.push([]);
    } else {
      groups[groups.length - 1].push(chunk);
    }
  }
  return groups;
}

function isColumnNode(n: unknown): n is { name: string } {
  return (
    n !== null && typeof n === "object" && !(n instanceof SQL) &&
    "table" in n && typeof (n as unknown as { name: unknown }).name === "string"
  );
}

function isParamNode(n: unknown): n is { value: unknown } {
  return (
    n !== null && typeof n === "object" && !(n instanceof SQL) &&
    "value" in n && !Array.isArray((n as { value: unknown }).value) &&
    !("table" in n)
  );
}

function operandColumn(operand: unknown[]): string {
  let column: string | null = null;
  const walk = (n: unknown): void => {
    if (n instanceof SQL) {
      for (const c of n.queryChunks) walk(c);
      return;
    }
    if (isColumnNode(n)) column = n.name;
  };
  for (const c of operand) walk(c);
  if (column === null) throw new Error("operand has no column");
  return column;
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

const KEY_BY_COLUMN: Record<string, string> = {
  id: "id",
  user_id: "userId",
  course_id: "courseId",
  deadline: "deadline",
  created_at: "createdAt",
  deleted_at: "deletedAt",
};

function cell(row: Record<string, unknown>, column: string): unknown {
  const key = KEY_BY_COLUMN[column];
  if (!key) throw new Error(`unknown column ${column}`);
  return row[key];
}

function compareValues(cellValue: unknown, param: unknown): number {
  const c = cellValue instanceof Date ? cellValue.getTime() : cellValue;
  const p = param instanceof Date ? param.getTime() : param;
  if (typeof c === "string" && typeof p === "string") {
    return c < p ? -1 : c > p ? 1 : 0;
  }
  if (typeof c === "number" && typeof p === "number") {
    return c < p ? -1 : c > p ? 1 : 0;
  }
  throw new Error(`uncomparable values ${typeof c} vs ${typeof p}`);
}

function evalOperand(operand: unknown[], row: Record<string, unknown>): boolean {
  const text = operand.map(flatText).join("").toLowerCase();
  const column = operandColumn(operand);
  if (text.includes("is null")) {
    return cell(row, column) == null;
  }
  const param = operandParam(operand);
  if (text.includes(">=")) {
    return compareValues(cell(row, column), param) >= 0;
  }
  if (text.includes("<=")) {
    return compareValues(cell(row, column), param) <= 0;
  }
  if (text.includes(">") && !text.includes("=") && !text.includes("<")) {
    return compareValues(cell(row, column), param) > 0;
  }
  if (text.includes("<") && !text.includes("=") && !text.includes(">")) {
    return compareValues(cell(row, column), param) < 0;
  }
  if (text.includes("=")) {
    const c = cell(row, column);
    if (c instanceof Date && param instanceof Date) {
      return c.getTime() === param.getTime();
    }
    return c === param;
  }
  throw new Error(`unsupported predicate: ${text}`);
}

function evalWhere(node: unknown, row: Record<string, unknown>): boolean {
  const orGroups = splitTopLevel(node, "or");
  if (orGroups.length > 1) {
    // Each OR side is raw chunks: split conjunctions before evaluating.
    return orGroups.some((side) => evalConjunction(splitChunks(side, "and"), row));
  }
  return evalConjunction(splitTopLevel(node, "and"), row);
}

function evalConjunction(operands: unknown[][], row: Record<string, unknown>): boolean {
  return operands.every((op) => {
    // A lone nested condition (e.g. the cursor OR inside the top-level AND,
    // or one side of an OR).
    if (op.length === 1 && op[0] instanceof SQL) return evalWhere(op[0], row);
    return evalOperand(op, row);
  });
}

// ---------------------------------------------------------------------------
// Mock DB: records from()/where()/orderBy()/limit(), computes the page.
// ---------------------------------------------------------------------------
type OrderSpec = { key: string; dir: "asc" | "desc" };

function parseOrder(cols: unknown[]): OrderSpec[] {
  return cols.map((c) => {
    const text = flatText(c).toLowerCase();
    const m = /"([a-z_]+)"\s*(asc|desc)?/.exec(text);
    if (!m) throw new Error(`unparseable orderBy: ${text}`);
    const key = KEY_BY_COLUMN[m[1]];
    if (!key) throw new Error(`unknown order column ${m[1]}`);
    return { key, dir: (m[2] as "asc" | "desc") ?? "asc" };
  });
}

function sortRows<T extends Record<string, unknown>>(
  rows: T[],
  order: OrderSpec[],
): T[] {
  return [...rows].sort((a, b) => {
    for (const { key, dir } of order) {
      const av = a[key] instanceof Date ? (a[key] as Date).getTime() : a[key];
      const bv = b[key] instanceof Date ? (b[key] as Date).getTime() : b[key];
      if (av === bv) continue;
      const less = (av as string | number) < (bv as string | number);
      return dir === "asc" ? (less ? -1 : 1) : less ? 1 : -1;
    }
    return 0;
  });
}

function chain() {
  const state: { table?: unknown; where?: unknown; order?: OrderSpec[]; limit?: number } = {};
  const self: Record<string, (...args: never[]) => unknown> = {
    select: () => self,
    from: (table: never) => {
      state.table = table;
      return self;
    },
    leftJoin: () => self,
    innerJoin: () => self,
    where: (cond: never) => {
      state.where = cond;
      return self;
    },
    orderBy: (...cols: never[]) => {
      state.order = parseOrder(cols);
      return self;
    },
    limit: (n: never) => {
      state.limit = n as unknown as number;
      return compute();
    },
    then: (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) =>
      Promise.resolve(compute()).then(resolve, reject),
  };
  function compute(): unknown[] {
    const n = state.limit ?? 50;
    if (state.table === tasks) {
      const filtered = taskStore.filter((r) =>
        state.where ? evalWhere(state.where, r as unknown as Record<string, unknown>) : true,
      );
      const sorted = state.order ? sortRows(filtered, state.order) : filtered;
      return sorted.slice(0, n).map((r) => ({
        id: r.id, userId: r.userId, courseId: r.courseId, title: r.title,
        description: r.description, deadline: r.deadline, status: r.status,
        createdAt: r.createdAt, updatedAt: r.updatedAt,
        courseName: null, courseColor: null,
      }));
    }
    if (state.table === courses) {
      const filtered = courseStore.filter((r) =>
        state.where ? evalWhere(state.where, r as unknown as Record<string, unknown>) : true,
      );
      const sorted = state.order ? sortRows(filtered, state.order) : filtered;
      return sorted.slice(0, n).map((r) => ({ ...r }));
    }
    throw new Error("unexpected table in list mock");
  }
  return self;
}

mock.module("../lib/db", () => ({
  getDb: () => ({ select: () => chain() }),
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

function authedAs(userId: string, capabilities: Capability[]) {
  setVerifyAccessTokenOverride(async () => ({
    id: userId,
    email: `${userId}@example.com`,
    sessionId: "s",
  }));
  setLoadAuthorizationContextOverride(async (subject) =>
    createAuthorizationContext({ subject, roles: ["user"], capabilities }),
  );
}

const TASK_CAPS: Capability[] = ["task.view"];
const COURSE_CAPS: Capability[] = ["course.view"];

beforeEach(() => {
  resetRateLimitBuckets();
  seedStores();
});

type TaskPage = {
  tasks: { id: string; title: string }[];
  page: { nextCursor: string | null; limit: number };
};

async function getTasks(qs: string) {
  const res = await app.handle(
    new Request(`http://localhost/api/v1/tasks${qs}`, {
      headers: { authorization: "Bearer user-a" },
    }),
  );
  expect(res.status).toBe(200);
  return (await res.json()) as TaskPage;
}

describe("F-6 — GET /tasks pagination traversal", () => {
  beforeEach(() => authedAs(USER_A, TASK_CAPS));

  test("paginates limit=2 over 3 rows: page, cursor, tail", async () => {
    const p1 = await getTasks("?limit=2");
    expect(p1.tasks.map((t) => t.id)).toEqual([T1, T2]);
    expect(p1.page.limit).toBe(2);
    expect(p1.page.nextCursor).toBeTruthy();

    const p2 = await getTasks(`?limit=2&cursor=${encodeURIComponent(p1.page.nextCursor!)}`);
    expect(p2.tasks.map((t) => t.id)).toEqual([T3]);
    // Tail: fewer rows than the limit → no further cursor.
    expect(p2.page.nextCursor).toBeNull();

    // Tenant scoping on every page: B's row and the soft-deleted row never appear.
    for (const page of [p1, p2]) {
      expect(page.tasks.some((t) => t.id === TB)).toBe(false);
      expect(page.tasks.some((t) => t.id === TD)).toBe(false);
    }
  });

  test("sort=createdAt + courseId combo returns the exact subset in order", async () => {
    const res = await app.handle(
      new Request(
        `http://localhost/api/v1/tasks?sort=createdAt&courseId=${COURSE_A}`,
        { headers: { authorization: "Bearer user-a" } },
      ),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as TaskPage;
    // createdAt ascending within course A: T3 (09-01) before T1 (09-03) —
    // the reverse of deadline order, proving both params applied.
    expect(body.tasks.map((t) => t.id)).toEqual([T3, T1]);
  });

  test("invalid sort is 400 with code, not a silent default", async () => {
    const res = await app.handle(
      new Request("http://localhost/api/v1/tasks?sort=drop_table", {
        headers: { authorization: "Bearer user-a" },
      }),
    );
    expect(res.status).toBe(400);
    const body = (await res.json()) as {
      error?: { code?: string };
      requestId?: string;
    };
    expect(body.error?.code).toBe("VALIDATION_ERROR");
    expect(body.requestId).toBeTruthy();
  });

  test("list projection omits description (detail keeps it)", async () => {
    const page = await getTasks("?limit=2");
    expect(page.tasks.length).toBeGreaterThan(0);
    for (const task of page.tasks as unknown as Record<string, unknown>[]) {
      expect("description" in task).toBe(false);
      expect(task.title).toBeTruthy();
    }
  });

  test("dueFrom/dueTo window is half-open [from, to)", async () => {
    // Deadlines: T1 12-01, T2 12-05, T3 12-10 (USER_A, active).
    const page = await getTasks(
      "?dueFrom=2026-12-01T00:00:00Z&dueTo=2026-12-10T00:00:00Z&limit=50",
    );
    expect(page.tasks.map((t) => t.id).sort()).toEqual([T1, T2].sort());
  });

  test("dueTo is exclusive at the exact boundary", async () => {
    // T1 deadline 2026-12-01T09:00:00Z: inside [from, to) only when to is after it.
    const inside = await getTasks(
      "?dueFrom=2026-12-01T00:00:00Z&dueTo=2026-12-01T09:00:01Z&limit=50",
    );
    expect(inside.tasks.map((t) => t.id)).toEqual([T1]);
    const outside = await getTasks(
      "?dueFrom=2026-12-01T00:00:00Z&dueTo=2026-12-01T09:00:00Z&limit=50",
    );
    expect(outside.tasks.map((t) => t.id)).toEqual([]);
  });

  test("invalid range params are 400", async () => {
    for (const qs of [
      "?dueFrom=not-a-date",
      "?dueTo=2026-13-99T99:99:99Z",
      "?dueFrom=2026-12-10T00:00:00Z&dueTo=2026-12-01T00:00:00Z",
    ]) {
      const res = await app.handle(
        new Request(`http://localhost/api/v1/tasks${qs}`, {
          headers: { authorization: "Bearer user-a" },
        }),
      );
      expect(res.status).toBe(400);
    }
  });
});

describe("F-6 — GET /courses pagination traversal (newest-first)", () => {
  beforeEach(() => authedAs(USER_A, COURSE_CAPS));

  test("paginates limit=1 over 2 rows with desc cursors", async () => {
    const r1 = await app.handle(
      new Request("http://localhost/api/v1/courses?limit=1", {
        headers: { authorization: "Bearer user-a" },
      }),
    );
    expect(r1.status).toBe(200);
    const p1 = (await r1.json()) as {
      courses: { id: string }[];
      page: { nextCursor: string | null };
    };
    expect(p1.courses.map((c) => c.id)).toEqual([COURSE_B]);
    expect(p1.page.nextCursor).toBeTruthy();

    const r2 = await app.handle(
      new Request(
        `http://localhost/api/v1/courses?limit=1&cursor=${encodeURIComponent(p1.page.nextCursor!)}`,
        { headers: { authorization: "Bearer user-a" } },
      ),
    );
    expect(r2.status).toBe(200);
    const p2 = (await r2.json()) as {
      courses: { id: string }[];
      page: { nextCursor: string | null };
    };
    expect(p2.courses.map((c) => c.id)).toEqual([COURSE_A]);
    expect(p2.page.nextCursor).toBeNull();
  });
});
