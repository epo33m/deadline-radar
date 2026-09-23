/**
 * Finding #4 regression tests: ownership must be part of the ACTUAL
 * mutation predicate, not only of a prior authorization lookup.
 *
 * Strategy:
 * - Route-level behavior (200 for owner, 404 + zero mutations for
 *   non-owner / nonexistent) through `app.handle` with mocked provider
 *   layers, mirroring `authorization.routes.test.ts`.
 * - Mutation-predicate proof: the mock DB records every `.where()`
 *   condition of `update`/`delete` calls; the condition is rendered to
 *   real PostgreSQL via `PgDialect.sqlToQuery` and asserted to contain
 *   the `user_id` ownership predicate with the requester's id as a bound
 *   parameter. These assertions fail against the old
 *   `where(eq(resource.id, id))` implementation.
 */
process.env.NODE_ENV = "test";
process.env.AUTH_BRIDGE_SECRET ??= "test-auth-bridge-secret";
import { beforeEach, describe, expect, mock, test } from "bun:test";
import { Name, Param, SQL } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";

import {
  createAuthorizationContext,
  setLoadAuthorizationContextOverride,
  setOwnershipOverrides,
  type Capability,
} from "../lib/authorization";
import { setVerifyAccessTokenOverride } from "../lib/auth-tokens";

const USER_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const USER_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const ATT_A = "11111111-1111-4111-8111-111111111111";
const ATT_B = "22222222-2222-4222-8222-222222222222";
const ATT_MISSING = "33333333-3333-4333-8333-333333333333";
const NOTIF_A = "44444444-4444-4444-8444-444444444444";
const NOTIF_B = "55555555-5555-4555-8555-555555555555";
const NOTIF_MISSING = "66666666-6666-4666-8666-666666666666";

// ---------------------------------------------------------------------------
// Recording mock DB: every builder method returns the chain; terminals
// resolve canned rows. Mutation `.where()` conditions are captured for
// SQL-level ownership assertions.
// ---------------------------------------------------------------------------
type RecordedMutation = { op: "update" | "delete"; where: unknown };

const recordedMutations: RecordedMutation[] = [];
/** Every `.where()` condition of `select` chains (ownership subqueries). */
const recordedSelectWheres: unknown[][] = [];
let selectResultQueue: unknown[][] = [];
let updateResultRows: unknown[] = [{ id: "row" }];
let deleteResultRows: unknown[] = [{ id: "row" }];

function chain(op: "select" | "insert" | "update" | "delete") {
  const state: { where?: unknown } = {};
  const recordMutation = () => {
    if ((op === "update" || op === "delete") && state.where !== undefined) {
      recordedMutations.push({ op, where: state.where });
    }
  };
  const self = {
    from: () => self,
    innerJoin: () => self,
    leftJoin: () => self,
    set: () => self,
    values: () => self,
    where: (condition: unknown) => {
      state.where = condition;
      if (op === "select") recordedSelectWheres.push([condition]);
      return self;
    },
    orderBy: () => self,
    limit: async () => selectResultQueue.shift() ?? [],
    returning: async () => {
      recordMutation();
      return op === "delete" ? deleteResultRows : updateResultRows;
    },
    then: (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) => {
      recordMutation();
      return Promise.resolve(
        op === "delete" ? deleteResultRows : updateResultRows,
      ).then(resolve, reject);
    },
  };
  return self;
}

mock.module("../lib/auth-audit", () => ({
  recordAuthEvent: async () => undefined,
}));

mock.module("../lib/db", () => ({
  getDb: () => ({
    select: () => chain("select"),
    insert: () => chain("insert"),
    update: () => chain("update"),
    delete: () => chain("delete"),
  }),
}));

mock.module("../lib/supabase", () => ({
  createAnonClient: () => ({ auth: {} }),
  createUserClient: () => ({ auth: {} }),
  createServiceClient: () => ({
    storage: {
      from: () => ({
        remove: async () => ({ data: [], error: null }),
        createSignedUrl: async () => ({ data: null, error: null }),
      }),
    },
  }),
}));

const { resetRateLimitBuckets } = await import("../plugins/rate-limit");
const { app } = await import("../app");

const dialect = new PgDialect();

/**
 * Recursively collect every referenced column identifier and every bound
 * parameter from a drizzle condition, descending into nested subqueries
 * (the ownership scope lives in an `IN (SELECT … WHERE user_id = …)`
 * subquery, which the flat renderer collapses to a single `$n` placeholder).
 */
function isContainerNode(node: unknown): boolean {
  if (node instanceof SQL || node instanceof Name || node instanceof Param) {
    return true;
  }
  if (node !== null && typeof node === "object") {
    const record = node as Record<string, unknown>;
    if (typeof record["getSQL"] === "function") return true;
    if (Array.isArray(record["queryChunks"])) return true;
  }
  return false;
}

function collectConditionParts(
  node: unknown,
  names: string[],
  params: unknown[],
  seen: Set<unknown> = new Set(),
): void {
  if (node === null || node === undefined || typeof node !== "object") {
    params.push(node);
    return;
  }
  // Some drizzle nodes are self-referential (getSQL() wraps `this`).
  if (seen.has(node)) return;
  seen.add(node);
  if (node instanceof SQL) {
    for (const chunk of node.queryChunks) {
      collectConditionParts(chunk, names, params, seen);
    }
    return;
  }
  if (node instanceof Name) {
    names.push(node.value);
    return;
  }
  if (node instanceof Param) {
    const value = (node as Param<unknown>).value as unknown;
    if (isContainerNode(value)) {
      collectConditionParts(value, names, params, seen);
    } else {
      params.push(value);
    }
    return;
  }
  {
    const record = node as Record<string, unknown>;
    // Drizzle Column: record its logical name (e.g. "user_id").
    // Non-exclusive: columns may also expose getSQL/queryChunks, which are
    // still walked below for nested identifiers and bound values.
    if (
      typeof record["name"] === "string" &&
      (record["name"] as string).length > 0
    ) {
      names.push(record["name"] as string);
    }
    if (typeof record["getSQL"] === "function") {
      collectConditionParts(
        (record["getSQL"] as () => unknown)(),
        names,
        params,
        seen,
      );
      return;
    }
    if (Array.isArray(record["queryChunks"])) {
      for (const chunk of record["queryChunks"] as unknown[]) {
        collectConditionParts(chunk, names, params, seen);
      }
      return;
    }
    if (!("name" in record)) {
      params.push(node);
    }
  }
}

function renderWhere(where: unknown): {
  sql: string;
  params: unknown[];
  columns: string[];
} {
  const query = dialect.sqlToQuery(where as SQL);
  const columns: string[] = [];
  const params: unknown[] = [];
  collectConditionParts(where, columns, params);
  return { sql: query.sql, params: [...query.params, ...params], columns };
}

/** The mutation recorded for `op`, asserting exactly one exists. */
function singleMutation(op: "update" | "delete") {
  const matches = recordedMutations.filter((m) => m.op === op);
  expect(matches.length).toBe(1);
  return renderWhere(matches[0].where);
}

/**
 * The ownership subquery (`IN (SELECT id FROM tasks WHERE user_id = …)`)
 * is built with real drizzle code even when `getDb` is mocked, so its
 * captured condition can be inspected directly. It is always the LAST
 * recorded select condition (built as part of the mutation, after any
 * authorization lookup).
 */
function ownershipSubqueryCondition() {
  expect(recordedSelectWheres.length).toBeGreaterThan(0);
  return renderWhere(
    recordedSelectWheres[recordedSelectWheres.length - 1][0],
  );
}

function authedAs(capabilities: Capability[]) {
  setVerifyAccessTokenOverride(async (t) => {
    if (t === "user-a")
      return { id: USER_A, email: "a@example.com", sessionId: "sa" };
    if (t === "user-b")
      return { id: USER_B, email: "b@example.com", sessionId: "sb" };
    return null;
  });
  setLoadAuthorizationContextOverride(async (subject) =>
    createAuthorizationContext({
      subject,
      roles: ["user"],
      capabilities,
    }),
  );
}

function linkAttachmentRow(id: string) {
  return {
    attachment: {
      id,
      taskId: "task-1",
      type: "link" as const,
      notes: null,
      storagePath: null,
      url: "https://example.com/x",
      createdAt: new Date(),
    },
    taskUserId: USER_A,
  };
}

describe("finding #4 — ownership inside the mutation", () => {
  beforeEach(() => {
    resetRateLimitBuckets();
    recordedMutations.length = 0;
    recordedSelectWheres.length = 0;
    selectResultQueue = [];
    updateResultRows = [{ id: "row" }];
    deleteResultRows = [{ id: "row" }];
    setVerifyAccessTokenOverride(null);
    setLoadAuthorizationContextOverride(null);
    setOwnershipOverrides(null);
  });

  test("user A deletes own attachment → 200 and mutation carries user_id", async () => {
    authedAs(["attachment.delete"]);
    setOwnershipOverrides({
      ownedAttachment: async (userId, attachmentId) =>
        userId === USER_A && attachmentId === ATT_A
          ? linkAttachmentRow(ATT_A)
          : null,
    });

    const response = await app.handle(
      new Request(`http://localhost/api/v1/attachments/${ATT_A}`, {
        method: "DELETE",
        headers: { authorization: "Bearer user-a" },
      }),
    );
    expect(response.status).toBe(200);

    // The mutation targets the attachment table by id …
    const { sql, params } = singleMutation("delete");
    expect(sql).toContain("attachments");
    expect(params).toContain(ATT_A);
    // … and its ownership subquery is scoped to the requester. Against the
    // old `where(eq(attachments.id, id))` implementation no select condition
    // is recorded at all here (the lookup is stubbed via overrides).
    expect(recordedSelectWheres.length).toBe(1);
    const subquery = ownershipSubqueryCondition();
    expect(subquery.columns).toContain("user_id");
    expect(subquery.params).toContain(USER_A);
  });

  test("user A deletes user B attachment → 404 and no delete mutation runs", async () => {
    authedAs(["attachment.delete"]);
    setOwnershipOverrides({
      ownedAttachment: async (userId, attachmentId) =>
        userId === USER_A && attachmentId === ATT_A
          ? linkAttachmentRow(ATT_A)
          : null,
    });

    const response = await app.handle(
      new Request(`http://localhost/api/v1/attachments/${ATT_B}`, {
        method: "DELETE",
        headers: { authorization: "Bearer user-a" },
      }),
    );
    expect(response.status).toBe(404);
    const body = (await response.json()) as {
      error?: { code?: string } | string;
    };
    const err = body.error;
    expect(typeof err === "string" ? err : err?.code).toBe("NOT_FOUND");
    // B's resource is untouched at the mutation layer: zero delete calls.
    expect(recordedMutations.filter((m) => m.op === "delete").length).toBe(0);
  });

  test("delete nonexistent attachment → 404 existing behavior", async () => {
    authedAs(["attachment.delete"]);
    setOwnershipOverrides({
      ownedAttachment: async () => null,
    });

    const response = await app.handle(
      new Request(`http://localhost/api/v1/attachments/${ATT_MISSING}`, {
        method: "DELETE",
        headers: { authorization: "Bearer user-a" },
      }),
    );
    expect(response.status).toBe(404);
  });

  test("user A marks own notification read → 200 and mutation carries user_id", async () => {
    authedAs(["notification.mark-read"]);
    selectResultQueue = [[{ id: NOTIF_A }]];

    const response = await app.handle(
      new Request(`http://localhost/api/v1/notifications/${NOTIF_A}/read`, {
        method: "POST",
        headers: { authorization: "Bearer user-a" },
      }),
    );
    expect(response.status).toBe(200);

    const { params } = singleMutation("update");
    expect(params).toContain(NOTIF_A);
    // Two select conditions: the authorization lookup plus the mutation's
    // ownership subquery (old code records only the lookup).
    expect(recordedSelectWheres.length).toBe(2);
    // The last recorded select condition is the mutation's ownership
    // subquery (the authorization lookup is recorded first).
    const subquery = ownershipSubqueryCondition();
    expect(subquery.columns).toContain("user_id");
    expect(subquery.params).toContain(USER_A);
  });

  test("user A marks user B notification read → 404 and no update mutation runs", async () => {
    authedAs(["notification.mark-read"]);
    // Ownership lookup finds nothing for B's notification.
    selectResultQueue = [[]];

    const response = await app.handle(
      new Request(`http://localhost/api/v1/notifications/${NOTIF_B}/read`, {
        method: "POST",
        headers: { authorization: "Bearer user-a" },
      }),
    );
    expect(response.status).toBe(404);
    const body = (await response.json()) as {
      error?: { code?: string } | string;
    };
    const err = body.error;
    expect(typeof err === "string" ? err : err?.code).toBe("NOT_FOUND");
    // B's notification stays unread at the mutation layer: zero updates.
    expect(recordedMutations.filter((m) => m.op === "update").length).toBe(0);
  });

  test("mark nonexistent notification read → 404 existing behavior", async () => {
    authedAs(["notification.mark-read"]);
    selectResultQueue = [[]];

    const response = await app.handle(
      new Request(
        `http://localhost/api/v1/notifications/${NOTIF_MISSING}/read`,
        {
          method: "POST",
          headers: { authorization: "Bearer user-a" },
        },
      ),
    );
    expect(response.status).toBe(404);
  });
});
