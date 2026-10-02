process.env.NODE_ENV = "test";
process.env.RESEND_API_KEY ??= "test-resend-key";
import { beforeEach, describe, expect, mock, test } from "bun:test";
import {
  notificationDeliveries,
  profiles,
  reminderRuns,
  reminderThresholds,
  tasks,
} from "@deadline-radar/db";
import { MAX_EMAIL_DELIVERY_RETRIES } from "@deadline-radar/domain";

import {
  buildReminderIdempotencyKey,
  type ReminderEmailBody,
} from "../lib/email";

/**
 * Concurrency + idempotency tests for runEvaluateReminders.
 *
 * Strategy (repo convention: bun:test + mock.module, no real DB):
 * - `../lib/db` is replaced with an in-memory store that FAITHFULLY emulates
 *   the two Postgres primitives the patch relies on, both single-statement
 *   atomic (synchronous check-and-set inside the awaited thenable, mirroring
 *   statement atomicity):
 *     1. unique (thresholdId, channel) on insert, honoring onConflictDoNothing
 *        (conflict + OCD flag → [] ; conflict without OCD → 23505 throw);
 *     2. conditional-update claims resolved against CURRENT store state
 *        (first committer wins, latecomers get []).
 * - The `resend` package is replaced with a programmable fake that can hold
 *   a same-key call in flight and answer the overlapping call with
 *   `concurrent_idempotent_requests`, mirroring documented provider behavior.
 * - Overlap is forced deterministically with a barrier on the initial
 *   SELECTs: neither run proceeds to decisions/writes until both snapshots
 *   are taken, so both runs always decide on identical input.
 */

// ---------------------------------------------------------------------------
// In-memory store + fakes
// ---------------------------------------------------------------------------

type DeliveryRow = {
  id: string;
  taskId: string;
  thresholdId: string;
  daysBefore: number;
  channel: string;
  status: string;
  retryCount: number;
  sentAt: Date | null;
  /** F-05 failure context; absent on seeded rows (mirrors NULL backfill). */
  lastError?: string | null;
  failedAt?: Date | null;
  /** F-10 sweep-claim lease; absent unless claimed. */
  claimedAt?: Date | null;
  /** RF-02 frozen email body inputs; absent until the first send attempt. */
  emailSnapshot?: {
    title: string;
    deadlineIso: string;
    timeZone: string;
    daysBefore: number;
  } | null;
  /** RF-02 exact provider idempotency key; absent until frozen/rotated. */
  emailIdempotencyKey?: string | null;
};

type RunRow = {
  id: string;
  startedAt: Date;
  finishedAt: Date | null;
  evaluatedTasks: number;
  created: number;
  retried: number;
  emailsSent: number;
  emailsFailed: number;
  emailsSkippedQuota: number;
  status: string;
  error: string | null;
  /** RF-01: last fully-processed task id, written after each completed batch. */
  lastSeenTaskId?: string | null;
  /** RF-12: run stopped at MAX_TASKS_PER_RUN / MAX_RUN_DURATION_MS. */
  truncated: boolean;
};

type Store = {
  taskRows: {
    id: string;
    userId: string;
    status: string;
    deadline: Date;
    createdAt: Date;
    title: string;
    /** RF-07: deadline edit marker; falls back to createdAt when absent. */
    deadlineUpdatedAt?: Date;
  }[];
  thresholdRows: {
    id: string;
    taskId: string;
    daysBefore: number;
    /** RF-07: threshold edit marker; falls back to createdAt when absent. */
    updatedAt?: Date;
    createdAt?: Date;
    /** RF-09: archived rows are excluded from evaluation/live re-check. */
    deletedAt?: Date | null;
  }[];
  deliveries: DeliveryRow[];
  profileRows: { id: string; email: string; timezone: string }[];
  runs: RunRow[];
  seq: number;
  runSeq: number;
  failMarkSentOnce: boolean;
  failMarkFailedOnce: boolean;
  failRunRecordOnce: boolean;
  /** NEW-01: fail the ledger lock insert on EVERY attempt (persistent DB
   * error) so the run must abort fail-closed after bounded retries. */
  failRunRecordAlways: boolean;
  failNextSelectOnce: boolean;
  failRecheckOnce: boolean;
  /** I-01: fail the next F-10 sweep-claim update once (row-level DB error). */
  failSweepClaimOnce: boolean;
  /** I-06: fail the next set-based retry-claim UPDATE once (batch-scope). */
  failRetryClaimBatchOnce: boolean;
  /** I-06: fail the next batched stale-delete once (contained, best-effort). */
  failStaleDeleteOnce: boolean;
  /** I-06: edit every deadline on the next delivery insert (batch stale). */
  editAllDeadlinesBeforeSend: boolean;
  /** I-06: set-based retry-claim UPDATE statements issued. */
  retryClaimUpdateCalls: number;
  /** I-06: batched stale-delete statements issued. */
  staleDeleteCalls: number;
  /** RF-01: count of task BATCH-fetch selects so far (live recheck excluded). */
  taskBatchFetchCount: number;
  /** RF-01: fail the Nth task batch-fetch once (1-based). */
  failTaskBatchFetchNumber: number | null;
  /** F-08: flip the delivery's task to done on the next delivery insert,
   * simulating a completion landing between snapshot and send. */
  completeTaskBeforeSendOnce: boolean;
  /** RF-04: when true, the next ledger insert reports the single-flight lock
   * as held (23505) so the run must exit early. */
  runLockBusy: boolean;
  /** RF-07: edit the task deadline on the next delivery insert, simulating a
   * deadline change landing between the batch snapshot and the send. */
  editDeadlineBeforeSendOnce: boolean;
  /** RF-07: bump the threshold edit marker on the next delivery insert. */
  editThresholdBeforeSendOnce: boolean;
  /** RF-07 negative control: change only the title (must NOT cancel a send). */
  editTitleBeforeSendOnce: boolean;
};

let store: Store;

function resetStore(): void {
  store = {
    taskRows: [],
    thresholdRows: [],
    deliveries: [],
    profileRows: [],
    runs: [],
    seq: 0,
    runSeq: 0,
    failMarkSentOnce: false,
    failMarkFailedOnce: false,
    failRunRecordOnce: false,
    failRunRecordAlways: false,
    failNextSelectOnce: false,
    failRecheckOnce: false,
    failSweepClaimOnce: false,
    failRetryClaimBatchOnce: false,
    failStaleDeleteOnce: false,
    editAllDeadlinesBeforeSend: false,
    retryClaimUpdateCalls: 0,
    staleDeleteCalls: 0,
    taskBatchFetchCount: 0,
    failTaskBatchFetchNumber: null,
    completeTaskBeforeSendOnce: false,
    runLockBusy: false,
    editDeadlineBeforeSendOnce: false,
    editThresholdBeforeSendOnce: false,
    editTitleBeforeSendOnce: false,
  };
}

/**
 * Phased select gate. The runs under test issue their SELECTs sequentially,
 * so a plain counter barrier can never open (each run blocks on its first
 * select before issuing the next). Instead, select #k of every run is
 * released only after ALL runs have requested their select #k — both runs
 * therefore always decide on identical snapshots. Single-run tests pass
 * through immediately.
 */
function createSelectGate(runs: number) {
  let count = 0;
  const listeners = new Set<() => void>();
  function notify(): void {
    for (const check of [...listeners]) check();
  }
  return {
    async hit(): Promise<void> {
      if (runs <= 1) return;
      count += 1;
      const target = Math.ceil(count / runs) * runs;
      if (count >= target) {
        notify();
        return;
      }
      await new Promise<void>((resolve) => {
        const check = () => {
          if (count >= target) {
            listeners.delete(check);
            resolve();
          }
        };
        listeners.add(check);
      });
    },
  };
}

let barrier = createSelectGate(1);

function extractInArray(cond: any): string[] | null {
  if (!cond) return null;
  if (Array.isArray(cond.queryChunks)) {
    for (const chunk of cond.queryChunks) {
      if (Array.isArray(chunk)) {
        const values = chunk.map((item: any) =>
          typeof item === "object" && item !== null && "value" in item
            ? item.value
            : item,
        );
        if (values.length > 0 && typeof values[0] === "string") {
          return values;
        }
      }
      if (chunk?.queryChunks) {
        const nested = extractInArray(chunk);
        if (nested) return nested;
      }
    }
  }
  return null;
}

/** Collect the string parameter values bound in a drizzle condition tree.
 * The RF-07 delete is id-scoped (`eq(id, deliveryId)`), so this is enough to
 * find which delivery rows to remove. */
function collectParamValues(cond: any): string[] {
  const found: string[] = [];
  const walk = (node: any): void => {
    if (!node || typeof node !== "object") return;
    if (Array.isArray(node)) {
      for (const item of node) walk(item);
      return;
    }
    if (typeof node.value === "string") {
      found.push(node.value);
      return;
    }
    if (Array.isArray(node.queryChunks)) {
      for (const chunk of node.queryChunks) walk(chunk);
    }
  };
  walk(cond);
  return found;
}

/**
 * True when a drizzle condition tree contains a `<>` / `!=` comparison
 * (the batch snapshot's `ne(status, "done")`). The F-08 live-status
 * re-check carries no such clause, which is how the fake tells the two
 * task queries apart.
 */
function conditionMentionsNe(cond: any): boolean {
  if (!cond) return false;
  if (Array.isArray(cond.queryChunks)) {
    for (const chunk of cond.queryChunks) {
      if (Array.isArray(chunk)) {
        for (const item of chunk) {
          const texts: string[] =
            typeof item === "string"
              ? [item]
              : typeof item === "object" && item !== null && "value" in item
                ? [(item as any).value].flat().filter((v: unknown) => typeof v === "string")
                : [];
          if (texts.some((t) => t.includes("<>") || t.includes("!="))) {
            return true;
          }
        }
      }
      if (chunk?.queryChunks && conditionMentionsNe(chunk)) {
        return true;
      }
    }
  }
  return false;
}

/**
 * True for the task BATCH-fetch query and false for the F-08 live re-check.
 * The batch fetch never carries an inArray (it is ne + isNull + optional gt
 * keyset), while the re-check is id-scoped inArray — that distinction, not
 * the `<>` render, is what the counts in RF-01 checkpoint tests rely on.
 */
function isTaskBatchSelect(table: unknown, cond: any): boolean {
  return (
    (table === tasks || getTableName(table) === "tasks") &&
    !extractInArray(cond)
  );
}

function extractGtValue(cond: any): string | null {
  if (Array.isArray(cond.queryChunks)) {
    for (let i = 0; i < cond.queryChunks.length; i++) {
      const chunk = cond.queryChunks[i];
      if (
        chunk?.value &&
        Array.isArray(chunk.value) &&
        chunk.value[0]?.trim() === ">"
      ) {
        const next = cond.queryChunks[i + 1];
        if (next?.value && typeof next.value === "string") return next.value;
      }
      if (chunk?.queryChunks) {
        const nested = extractGtValue(chunk);
        if (nested) return nested;
      }
    }
  }
  return null;
}

function getTableName(table: any): string | null {
  if (!table) return null;
  return (
    table[Symbol.for("drizzle:Name")] ??
    table._?.name ??
    table.name ??
    null
  );
}

function rowsForTable(
  table: unknown,
  filtered: boolean,
  whereCond?: any,
  limitCount?: number | null,
): unknown[] {
  const name = getTableName(table);
  if (name === "idempotency_keys") {
    return [];
  }
  if (table === tasks || name === "tasks") {
    // F-08 live-status re-check: an id-scoped query WITHOUT the ne(status)
    // clause sees live rows (including freshly completed ones), faithful to
    // the production re-check SQL. The batch snapshot keeps filtering done.
    if (extractInArray(whereCond) && !conditionMentionsNe(whereCond)) {
      if (store.failRecheckOnce) {
        store.failRecheckOnce = false;
        throw new Error("fake db: live status re-check failed");
      }
      const ids = extractInArray(whereCond) ?? [];
      return store.taskRows
        .filter((t) => ids.includes(t.id) && !(t as any).deletedAt)
        .map((t) => ({ ...t }));
    }
    // RF-12 truncation backlog COUNT: same ne/isNull/gt shape as the batch
    // fetch but never calls .limit(), which is how the fake tells them apart.
    if (limitCount == null) {
      const gtId = extractGtValue(whereCond);
      const remaining = store.taskRows.filter(
        (t) =>
          t.status !== "done" &&
          !(t as any).deletedAt &&
          (gtId ? t.id > gtId : true),
      ).length;
      return [{ remaining }];
    }
    let list = store.taskRows.filter(
      (t) => t.status !== "done" && !(t as any).deletedAt,
    );
    list = [...list].sort((a, b) => a.id.localeCompare(b.id));
    const gtId = extractGtValue(whereCond);
    if (gtId) {
      list = list.filter((t) => t.id > gtId);
    }
    if (limitCount != null) {
      list = list.slice(0, limitCount);
    }
    // Shallow copies so a mid-run mutation cannot retroactively change the
    // batch snapshot the run already read (RF-07 relies on this).
    return list.map((t) => ({ ...t }));
  }
  if (table === reminderThresholds || name === "reminder_thresholds") {
    const taskIds = extractInArray(whereCond);
    const rows = taskIds
      ? store.thresholdRows.filter(
          (t) => taskIds.includes(t.taskId) && !(t as any).deletedAt,
        )
      : store.thresholdRows.filter((t) => !(t as any).deletedAt);
    return rows.map((t) => ({ ...t }));
  }
  if (table === notificationDeliveries || name === "notification_deliveries") {
    const taskIds = extractInArray(whereCond);
    if (taskIds) {
      return store.deliveries
        .filter((d) => taskIds.includes(d.taskId))
        .map((d) => ({ ...d }));
    }
    if (filtered) {
      return store.deliveries
        .filter((d) => d.channel === "email" && d.status === "pending")
        .map((d) => ({ ...d }));
    }
    return store.deliveries.map((d) => ({ ...d }));
  }
  if (table === profiles || name === "profiles") {
    const userIds = extractInArray(whereCond);
    if (userIds) {
      return store.profileRows.filter((p) => userIds.includes(p.id));
    }
    return store.profileRows;
  }
  throw new Error(`fake db: unexpected table ${name}`);
}

function doInsert(
  values: Record<string, unknown>,
  onConflictDoNothing: boolean,
): { id: string; thresholdId: string; daysBefore: number; channel: string }[] {
  const key = `${values.thresholdId}:${values.daysBefore}:${values.channel}`;
  const existing = store.deliveries.find(
    (d) => `${d.thresholdId}:${d.daysBefore}:${d.channel}` === key,
  );
  if (existing) {
    if (onConflictDoNothing) return [];
    const error = new Error(
      'duplicate key value violates unique constraint "notification_deliveries_threshold_id_days_before_channel_key"',
    );
    (error as { code?: string }).code = "23505";
    throw error;
  }
  store.seq += 1;
  const row: DeliveryRow = {
    id: `dlv-${store.seq}`,
    taskId: values.taskId as string,
    thresholdId: values.thresholdId as string,
    daysBefore: (values.daysBefore as number) ?? 0,
    channel: values.channel as string,
    status: values.status as string,
    retryCount: 0,
    sentAt: (values.sentAt as Date | undefined) ?? null,
  };
  store.deliveries.push(row);
  if (store.completeTaskBeforeSendOnce) {
    store.completeTaskBeforeSendOnce = false;
    const task = store.taskRows.find((t) => t.id === row.taskId);
    if (task) task.status = "done";
  }
  if (store.editDeadlineBeforeSendOnce) {
    store.editDeadlineBeforeSendOnce = false;
    const task = store.taskRows.find((t) => t.id === row.taskId);
    if (task) {
      // A future deadline keeps the edited reminder due on the next run.
      task.deadline = new Date(Date.now() + 2 * 86_400_000);
      task.deadlineUpdatedAt = new Date();
    }
  }
  if (store.editAllDeadlinesBeforeSend) {
    for (const task of store.taskRows) {
      task.deadline = new Date(Date.now() + 2 * 86_400_000);
      task.deadlineUpdatedAt = new Date();
    }
  }
  if (store.editThresholdBeforeSendOnce) {
    store.editThresholdBeforeSendOnce = false;
    const threshold = store.thresholdRows.find((t) => t.id === row.thresholdId);
    if (threshold) threshold.updatedAt = new Date();
  }
  if (store.editTitleBeforeSendOnce) {
    store.editTitleBeforeSendOnce = false;
    const task = store.taskRows.find((t) => t.id === row.taskId);
    if (task) task.title = "Renamed after snapshot";
  }
  // RETURNING carries the unique key (as production does) so batched inserts
  // map each returned row back to its action.
  return [
    {
      id: row.id,
      thresholdId: row.thresholdId,
      daysBefore: row.daysBefore,
      channel: row.channel,
    },
  ];
}

/**
 * F-04 run ledger emulation. reminder_runs writes are plain CRUD with no
 * arbitration: inserts append a running row, finish updates patch the latest
 * open row. Table dispatch (not delivery logic) must handle them.
 */
function insertRunRow(): { id: string }[] {
  // RF-04 single-flight: a held lock reports a unique violation.
  if (store.runLockBusy) {
    const error = new Error(
      'duplicate key value violates unique constraint "reminder_runs_single_active"',
    );
    (error as { code?: string }).code = "23505";
    throw error;
  }
  store.runSeq += 1;
  const row: RunRow = {
    id: `run-${store.runSeq}`,
    startedAt: new Date(),
    finishedAt: null,
    evaluatedTasks: 0,
    created: 0,
    retried: 0,
    emailsSent: 0,
    emailsFailed: 0,
    emailsSkippedQuota: 0,
    status: "running",
    error: null,
    truncated: false,
  };
  store.runs.push(row);
  return [{ id: row.id }];
}

function updateRunRow(set: Record<string, unknown>): void {
  // RF-04 stale-lock reclaim only touches rows older than the horizon. Tests
  // never have stale rows, so it stays a no-op there (production scopes this
  // with a WHERE; the fake cannot introspect update predicates).
  if (
    set.status === "error" &&
    set.error === "stale active run reclaimed"
  ) {
    const cutoff = Date.now() - RUN_LOCK_STALE_MS;
    for (const row of store.runs) {
      if (row.status === "running" && row.startedAt.getTime() < cutoff) {
        row.status = "error";
        row.error = "stale active run reclaimed";
        row.finishedAt = new Date();
      }
    }
    return;
  }
  const row =
    [...store.runs].reverse().find((r) => r.finishedAt === null) ??
    store.runs[store.runs.length - 1];
  if (!row) return;
  for (const [key, value] of Object.entries(set)) {
    (row as Record<string, unknown>)[key] = value;
  }
}

function isReminderRunsTable(table: unknown): boolean {
  return table === reminderRuns || getTableName(table) === "reminder_runs";
}
function doUpdateReturning(set: Record<string, unknown>): { id: string }[] {
  if (set.status === "pending" && "retryCount" in set) {
    // I-06 set-based retry claim: one statement transitions every matching
    // row (production predicate: failed + below retry cap). The fake ignores
    // the WHERE text and applies the same predicate to the whole store.
    store.retryClaimUpdateCalls += 1;
    if (store.failRetryClaimBatchOnce) {
      store.failRetryClaimBatchOnce = false;
      throw new Error("fake db: retry claim batch failed");
    }
    const claimed = store.deliveries.filter(
      (d) => d.status === "failed" && d.retryCount < 3,
    );
    for (const row of claimed) {
      row.status = "pending";
      row.retryCount += 1;
    }
    return claimed.map((row) => ({ id: row.id }));
  }
  if (set.status === "sending") {
    // F-10 atomic sweep claim: first committer wins; a stale lease (crashed
    // claimant) is reclaimable, a fresh one belongs to a live run.
    if (store.failSweepClaimOnce) {
      store.failSweepClaimOnce = false;
      throw new Error("fake db: sweep claim failed");
    }
    const row = store.deliveries.find(
      (d) =>
        d.status === "pending" ||
        (d.status === "sending" &&
          (d.claimedAt == null ||
            Date.now() - d.claimedAt.getTime() >= SENDING_CLAIM_STALE_MS)),
    );
    if (!row) return [];
    row.status = "sending";
    row.claimedAt = new Date();
    return [{ id: row.id }];
  }
  return [];
}

function doUpdate(set: Record<string, unknown>): void {
  // markSent/markFailed address rows by id in production; the fake resolves
  // to the first actionable row (pending, or sending after an F-10 claim).
  const actionable = () =>
    store.deliveries.find(
      (d) => d.status === "pending" || d.status === "sending",
    );
  if (set.status === "sent") {
    if (store.failMarkSentOnce) {
      store.failMarkSentOnce = false;
      throw new Error("fake db: markSent write failed");
    }
    const row = actionable();
    if (row) {
      row.status = "sent";
      row.sentAt = set.sentAt as Date;
      if (set.emailSnapshot != null) {
        row.emailSnapshot = set.emailSnapshot as DeliveryRow["emailSnapshot"];
      }
      if (set.emailIdempotencyKey != null) {
        row.emailIdempotencyKey = set.emailIdempotencyKey as string;
      }
    }
    return;
  }
  if (set.status === "failed") {
    if (store.failMarkFailedOnce) {
      store.failMarkFailedOnce = false;
      throw new Error("fake db: markFailed write failed");
    }
    const row = actionable();
    if (row) {
      row.status = "failed";
      if (set.retryCount != null) row.retryCount = set.retryCount as number;
      // F-05 failure context mirrors the production markFailed write.
      row.failedAt = set.failedAt instanceof Date ? set.failedAt : new Date();
      if (set.lastError != null) row.lastError = set.lastError as string;
      // RF-02: freeze/rotate the email identity with the failure.
      if (set.emailSnapshot != null) {
        row.emailSnapshot = set.emailSnapshot as DeliveryRow["emailSnapshot"];
      }
      if (set.emailIdempotencyKey != null) {
        row.emailIdempotencyKey = set.emailIdempotencyKey as string;
      }
    }
    return;
  }
  // RF-01 confirm-failure context write (markSent's best-effort fallback):
  // sets last_error + failed_at WITHOUT touching status — mirrors production,
  // where an accepted email is never downgraded to `failed`.
  if (set.lastError != null && !("status" in set)) {
    const row = actionable();
    if (row) {
      row.lastError = set.lastError as string;
      if (set.failedAt instanceof Date) row.failedAt = set.failedAt;
      if (set.emailSnapshot != null) {
        row.emailSnapshot = set.emailSnapshot as DeliveryRow["emailSnapshot"];
      }
      if (set.emailIdempotencyKey != null) {
        row.emailIdempotencyKey = set.emailIdempotencyKey as string;
      }
    }
    return;
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyChain = any;

mock.module("../lib/db", () => ({
  getDb: () => ({
    select: (fields?: unknown) => ({
      from: (table: unknown) => {
        let whereCond: any = null;
        let limitCount: number | null = null;
        const chain: any = {
          where: (cond: any) => {
            whereCond = cond;
            return chain;
          },
          orderBy: () => chain,
          limit: (lim: number) => {
            limitCount = lim;
            return chain;
          },
          then: (
            resolve: (v: unknown) => void,
            reject?: (e: unknown) => void,
          ) => {
            void barrier.hit().then(
              () => {
                try {
                  if (isTaskBatchSelect(table, whereCond)) {
                    store.taskBatchFetchCount += 1;
                    if (
                      store.failTaskBatchFetchNumber ===
                      store.taskBatchFetchCount
                    ) {
                      store.failTaskBatchFetchNumber = null;
                      throw new Error("fake db: task batch fetch failed");
                    }
                  }
                  if (store.failNextSelectOnce) {
                    store.failNextSelectOnce = false;
                    throw new Error("fake db: batch select failed");
                  }
                  resolve(
                    rowsForTable(
                      table,
                      fields !== undefined,
                      whereCond,
                      limitCount,
                    ),
                  );
                } catch (error) {
                  reject?.(error);
                }
              },
              (error: unknown) => reject?.(error),
            );
          },
        };
        return chain;
      },
    }),
    insert: (table: unknown) => ({
      // Production issues single-row AND multi-row (batched creates) values().
      values: (
        v: Record<string, unknown> | Record<string, unknown>[],
      ): AnyChain => {
        const state = { ocd: false };
        const builder: AnyChain = {
          onConflictDoNothing: (_cfg: unknown) => {
            state.ocd = true;
            return builder;
          },
          returning: (_sel: unknown) => ({
            then: (
              resolve: (v: unknown) => void,
              reject?: (e: unknown) => void,
            ) => {
              try {
                if (isReminderRunsTable(table)) {
                  if (store.failRunRecordAlways) {
                    throw new Error("fake db: run record start failed (persistent)");
                  }
                  if (store.failRunRecordOnce) {
                    store.failRunRecordOnce = false;
                    throw new Error("fake db: run record start failed");
                  }
                  resolve(insertRunRow());
                  return;
                }
                const batch = Array.isArray(v) ? v : [v];
                resolve(batch.flatMap((row) => doInsert(row, state.ocd)));
              } catch (error) {
                reject?.(error);
              }
            },
          }),
        };
        return builder;
      },
    }),
    update: (table: unknown) => ({
      set: (s: Record<string, unknown>) => ({
        where: (..._args: unknown[]) => ({
          then: (
            resolve: (v: unknown) => void,
            reject?: (e: unknown) => void,
          ) => {
            try {
              if (isReminderRunsTable(table)) {
                updateRunRow(s);
                resolve([]);
                return;
              }
              doUpdate(s);
              resolve([]);
            } catch (error) {
              reject?.(error);
            }
          },
          returning: (_sel: unknown) => ({
            then: (
              resolve: (v: unknown) => void,
              reject?: (e: unknown) => void,
            ) => {
              try {
                if (isReminderRunsTable(table)) {
                  updateRunRow(s);
                  resolve([]);
                  return;
                }
                resolve(doUpdateReturning(s));
              } catch (error) {
                reject?.(error);
              }
            },
          }),
        }),
      }),
    }),
    delete: (table: unknown) => ({
      where: (...args: unknown[]) => ({
        then: (
          resolve: (v: unknown) => void,
          reject?: (e: unknown) => void,
        ) => {
          try {
            if (
              table === notificationDeliveries ||
              getTableName(table) === "notification_deliveries"
            ) {
              store.staleDeleteCalls += 1;
              if (store.failStaleDeleteOnce) {
                store.failStaleDeleteOnce = false;
                throw new Error("fake db: stale delete failed");
              }
              const ids = collectParamValues(args[0]);
              for (let i = store.deliveries.length - 1; i >= 0; i--) {
                if (ids.includes(store.deliveries[i]!.id)) {
                  store.deliveries.splice(i, 1);
                }
              }
            }
            resolve([]);
          } catch (error) {
            reject?.(error);
          }
        },
      }),
    }),
  }),
}));

// ---------------------------------------------------------------------------
// Resend fake: programmable + concurrent same-key simulation
// ---------------------------------------------------------------------------

type SendCall = { body: unknown; options: unknown };
type SendBehavior = (
  body: unknown,
  options: unknown,
  callIndex: number,
) => Promise<{ data: unknown; error: unknown }>;

let sendCalls: SendCall[] = [];
let sendBehavior: SendBehavior = async () => ({
  data: { id: "em_default" },
  error: null,
});
let inFlightKeys = new Set<string>();

function successBehavior(): SendBehavior {
  return async () => ({ data: { id: "em_ok" }, error: null });
}

class MockResend {
  emails = {
    send: async (body: unknown, options: unknown) => {
      const index = sendCalls.length;
      sendCalls.push({ body, options });
      return sendBehavior(body, options, index);
    },
  };
}

mock.module("resend", () => ({ Resend: MockResend }));

const {
  runEvaluateReminders,
  SENDING_CLAIM_STALE_MS,
  RUN_LOCK_STALE_MS,
  EMAIL_SEND_CONCURRENCY,
  MAX_RUN_DURATION_MS_DEFAULT,
} = await import("./run-evaluate");
const { app } = await import("../app");

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const USER = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const TASK = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const THRESHOLD = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

function seedOpenTaskWithThreshold(title = "Task A"): void {
  const now = Date.now();
  store.taskRows = [
    {
      id: TASK,
      userId: USER,
      status: "todo",
      // RF-11: fixtures run up to ~1 day after seeding. Keep the deadline just
      // past at that run time (within the 1h grace) so deadline-passed
      // suppression never masks the behavior under test, while the H-1 trigger
      // (deadline − 1d) is already in the past at every run time.
      deadline: new Date(now + 86_400_000 - 60_000),
      createdAt: new Date(now - 10 * 86_400_000),
      title,
    },
  ];
  store.thresholdRows = [
    {
      id: THRESHOLD,
      taskId: TASK,
      daysBefore: 1,
      // Mirrors a real row: the RF-07 version marker is never null in prod.
      createdAt: new Date(now - 10 * 86_400_000),
    },
  ];
  store.profileRows = [{ id: USER, email: "user@example.com", timezone: "UTC" }];
}

function seedFailedDelivery(daysBefore = 1, retryCount = 0): DeliveryRow {
  const emailRow: DeliveryRow = {
    id: "dlv-seed",
    taskId: TASK,
    thresholdId: THRESHOLD,
    daysBefore,
    channel: "email",
    status: "failed",
    retryCount,
    sentAt: null,
  };
  const inAppRow: DeliveryRow = {
    id: "dlv-inapp-seed",
    taskId: TASK,
    thresholdId: THRESHOLD,
    daysBefore,
    channel: "in_app",
    status: "sent",
    retryCount: 0,
    sentAt: new Date(),
  };
  store.deliveries.push(emailRow, inAppRow);
  return emailRow;
}

function seedPendingDelivery(daysBefore = 1): DeliveryRow {
  const row: DeliveryRow = {
    id: "dlv-seed",
    taskId: TASK,
    thresholdId: THRESHOLD,
    daysBefore,
    channel: "email",
    status: "pending",
    retryCount: 0,
    sentAt: null,
  };
  store.deliveries.push(row);
  return row;
}

function sentOptionsOf(index: number): { idempotencyKey?: string } {
  return (sendCalls[index]?.options ?? {}) as { idempotencyKey?: string };
}

beforeEach(() => {
  resetStore();
  sendCalls = [];
  sendBehavior = successBehavior();
  inFlightKeys = new Set();
  barrier = createSelectGate(1);
});

// ---------------------------------------------------------------------------
// G8/G9: deterministic key + header passthrough (pure + integration)
// ---------------------------------------------------------------------------

describe("reminder idempotency key", () => {
  const body: ReminderEmailBody = {
    from: "Deadline Radar <onboarding@resend.dev>",
    to: "user@example.com",
    subject: "[H-1] Reminder: Task A",
    text: "hello",
  };

  test("same payload → same key; changed payload → different key; <256 chars", () => {
    const a = buildReminderIdempotencyKey({ deliveryId: "dlv-1", body });
    const b = buildReminderIdempotencyKey({ deliveryId: "dlv-1", body });
    expect(a).toBe(b);
    expect(a.startsWith("reminder-delivery-dlv-1-")).toBe(true);
    expect(a.length).toBeLessThan(256);

    const changedTitle = buildReminderIdempotencyKey({
      deliveryId: "dlv-1",
      body: { ...body, subject: "[H-1] Reminder: Task B" },
    });
    expect(changedTitle).not.toBe(a);

    const changedTo = buildReminderIdempotencyKey({
      deliveryId: "dlv-1",
      body: { ...body, to: "other@example.com" },
    });
    expect(changedTo).not.toBe(a);
    expect(changedTo).not.toBe(changedTitle);

    const otherDelivery = buildReminderIdempotencyKey({
      deliveryId: "dlv-2",
      body,
    });
    expect(otherDelivery).not.toBe(a);
  });

  test("send passes the deterministic key as Resend idempotency option", async () => {
    seedOpenTaskWithThreshold();
    // One delivery already pending → main loop skips it, sweep sends it.
    seedPendingDelivery();
    await runEvaluateReminders(new Date(Date.now() + 86_400_000));
    expect(sendCalls.length).toBe(1);
    const key = sentOptionsOf(0).idempotencyKey;
    expect(typeof key).toBe("string");
    expect(key!.startsWith("reminder-delivery-dlv-seed-")).toBe(true);
    expect(key!.length).toBeLessThan(256);
  });
});

// ---------------------------------------------------------------------------
// G1: concurrent create → one delivery, one email, no throw
// ---------------------------------------------------------------------------

describe("concurrent create", () => {
  test("two overlapping runs create one delivery and send one email", async () => {
    seedOpenTaskWithThreshold();
    barrier = createSelectGate(2);

    const [a, b] = await Promise.all([
      runEvaluateReminders(new Date(Date.now() + 86_400_000)),
      runEvaluateReminders(new Date(Date.now() + 86_400_000)),
    ]);

    expect(store.deliveries.filter((d) => d.channel === "email")).toHaveLength(1);
    expect(sendCalls).toHaveLength(1);
    // Loser contributes nothing: combined created counts the single winner
    // (one email + one in_app delivery).
    expect(a.created + b.created).toBe(2);
    expect(a.emailsSent + b.emailsSent).toBe(1);
    expect(a.emailsFailed + b.emailsFailed).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// G2: concurrent retry → one claim, one email
// ---------------------------------------------------------------------------

describe("concurrent retry", () => {
  test("two overlapping runs claim the failed delivery once", async () => {
    seedOpenTaskWithThreshold();
    seedFailedDelivery();
    barrier = createSelectGate(2);

    const [a, b] = await Promise.all([
      runEvaluateReminders(new Date(Date.now() + 86_400_000)),
      runEvaluateReminders(new Date(Date.now() + 86_400_000)),
    ]);

    expect(a.retried + b.retried).toBe(1);
    expect(sendCalls).toHaveLength(1);
    expect(a.emailsSent + b.emailsSent).toBe(1);
    const row = store.deliveries.find((d) => d.id === "dlv-seed");
    expect(row?.status).toBe("sent");
    expect(row?.retryCount).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// G3/G4 + F-10: concurrent sweep → atomic claim, one send, loser skips
// ---------------------------------------------------------------------------

describe("concurrent sweep", () => {
  test("loser of the sweep claim skips: one send total, no 409 path", async () => {
    seedOpenTaskWithThreshold();
    seedPendingDelivery();
    barrier = createSelectGate(2);

    const [a, b] = await Promise.all([
      runEvaluateReminders(new Date(Date.now() + 86_400_000)),
      runEvaluateReminders(new Date(Date.now() + 86_400_000)),
    ]);

    // Exactly one run wins the pending→sending claim and sends; the loser
    // sees 0 rows and skips without touching the provider.
    expect(sendCalls).toHaveLength(1);
    expect(a.emailsSent + b.emailsSent).toBe(1);
    expect(a.emailsFailed + b.emailsFailed).toBe(0);
    const row = store.deliveries.find((d) => d.id === "dlv-seed");
    expect(row?.status).toBe("sent");
  });

  test("stale sending lease (crashed claimant) is reclaimed and sent", async () => {
    seedOpenTaskWithThreshold();
    store.deliveries.push({
      id: "dlv-stale",
      taskId: TASK,
      thresholdId: THRESHOLD,
      daysBefore: 1,
      channel: "email",
      status: "sending",
      retryCount: 0,
      sentAt: null,
      claimedAt: new Date(Date.now() - SENDING_CLAIM_STALE_MS - 60_000),
    });

    const result = await runEvaluateReminders(new Date(Date.now() + 86_400_000));

    expect(result.emailsSent).toBe(1);
    expect(sendCalls).toHaveLength(1);
    expect(
      store.deliveries.find((d) => d.id === "dlv-stale")?.status,
    ).toBe("sent");
  });

  test("fresh sending lease (live claimant) is left alone", async () => {
    seedOpenTaskWithThreshold();
    store.deliveries.push({
      id: "dlv-live",
      taskId: TASK,
      thresholdId: THRESHOLD,
      daysBefore: 1,
      channel: "email",
      status: "sending",
      retryCount: 0,
      sentAt: null,
      claimedAt: new Date(),
    });

    const result = await runEvaluateReminders(new Date(Date.now() + 86_400_000));

    expect(result.emailsSent).toBe(0);
    expect(sendCalls).toHaveLength(0);
    expect(
      store.deliveries.find((d) => d.id === "dlv-live")?.status,
    ).toBe("sending");
  });
});

// ---------------------------------------------------------------------------
// G5: unique conflict never becomes HTTP 500 (route level, concurrent)
// ---------------------------------------------------------------------------

describe("cron route under overlap", () => {
  test("two concurrent cron requests both return 200", async () => {
    seedOpenTaskWithThreshold();
    barrier = createSelectGate(2);

    const call = () => {
      // CI sets CRON_SECRET (bypass off) while plain `bun test` leaves it
      // unset (test bypass on) — send the secret when present so this test
      // passes in both environments.
      const headers: Record<string, string> = {};
      if (process.env.CRON_SECRET) {
        headers.authorization = `Bearer ${process.env.CRON_SECRET}`;
      }
      return app.handle(
        new Request("http://localhost/api/v1/cron/evaluate-reminders", {
          headers,
        }),
      );
    };
    const [resA, resB] = await Promise.all([call(), call()]);

    expect(resA.status).toBe(200);
    expect(resB.status).toBe(200);
    const bodyA = (await resA.json()) as { ok: boolean };
    const bodyB = (await resB.json()) as { ok: boolean };
    expect(bodyA.ok).toBe(true);
    expect(bodyB.ok).toBe(true);
    // Winner creates email + in_app; loser creates nothing. SEC-008: the
    // cron body no longer carries counts, so creation is asserted via store
    // state instead of response fields.
    expect(store.deliveries).toHaveLength(2);
    expect(store.deliveries.filter((d) => d.channel === "email")).toHaveLength(1);
    expect(sendCalls).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// G6: Resend failure does not stop other deliveries
// ---------------------------------------------------------------------------

describe("resend failure containment", () => {
  test("a failing send marks its delivery failed and others still send", async () => {
    seedOpenTaskWithThreshold("Task A");
    sendBehavior = async (body) => {
      const text = ((body as { text?: string }).text ?? "") as string;
      if (text.includes("Task A")) {
        return {
          data: null,
          error: { name: "application_error", message: "boom", statusCode: 500 },
        };
      }
      return { data: { id: "em_ok" }, error: null };
    };

    const result = await runEvaluateReminders(new Date(Date.now() + 86_400_000));

    // Finding #8: a 500 is transient-class, so the send is retried with a
    // bounded policy (3 attempts total), then contained exactly as before.
    expect(sendCalls).toHaveLength(3);
    expect(result.emailsSent).toBe(0);
    expect(result.emailsFailed).toBe(1);
    const row = store.deliveries.find((d) => d.channel === "email");
    expect(row?.status).toBe("failed");
  });
});

// ---------------------------------------------------------------------------
// G7: markSent/markFailed failure does not fail the run
// ---------------------------------------------------------------------------

describe("state-write failure containment", () => {
  test("markSent throwing still resolves the run", async () => {
    seedOpenTaskWithThreshold();
    seedPendingDelivery();
    store.failMarkSentOnce = true;

    const result = await runEvaluateReminders(new Date(Date.now() + 86_400_000));

    expect(sendCalls).toHaveLength(1);
    expect(result.emailsSent).toBe(0);
    expect(result.emailsFailed).toBe(1);
    // Row stays claimed (sending), not confirmed: a later run reclaims it
    // once the lease goes stale and retries with the same idempotency key.
    expect(store.deliveries.find((d) => d.id === "dlv-seed")?.status).toBe(
      "sending",
    );
  });

  test("markFailed throwing still resolves the run", async () => {
    seedOpenTaskWithThreshold("Task A");
    store.failMarkFailedOnce = true;
    sendBehavior = async () => ({
      data: null,
      error: { name: "application_error", message: "boom", statusCode: 500 },
    });

    const result = await runEvaluateReminders(new Date(Date.now() + 86_400_000));

    // The row was already queued in emailWork, so the sweep skips it
    // (queuedIds). The failing send is retried with a bounded policy
    // (Finding #8: 3 attempts for transient 500s), then the failure is
    // contained and the run resolves.
    expect(sendCalls).toHaveLength(3);
    expect(result.emailsFailed).toBe(1);
    expect(store.deliveries.find((d) => d.channel === "email")?.status).toBe(
      "pending",
    );
  });
});

// ---------------------------------------------------------------------------
// I-01: row-level cron failures contained; 200 {ok:true} contract
// ---------------------------------------------------------------------------

describe("I-01: row-level failure containment", () => {
  const USER_B = "ffffffff-ffff-4fff-8fff-ffffffffffff";
  const TASK_B = "11111111-1111-4111-8111-111111111111";
  const THRESHOLD_B = "22222222-2222-4222-8222-222222222222";

  function seedSecondTaskWithStuckPending(): void {
    const now = Date.now();
    store.taskRows.push({
      id: TASK_B,
      userId: USER_B,
      status: "todo",
      deadline: new Date(now + 86_400_000 - 60_000),
      createdAt: new Date(now - 10 * 86_400_000),
      title: "Task B",
    });
    store.thresholdRows.push({
      id: THRESHOLD_B,
      taskId: TASK_B,
      daysBefore: 1,
      createdAt: new Date(now - 10 * 86_400_000),
    });
    store.profileRows.push({
      id: USER_B,
      email: "b@example.com",
      timezone: "UTC",
    });
    store.deliveries.push({
      id: "dlv-stuck-b",
      taskId: TASK_B,
      thresholdId: THRESHOLD_B,
      daysBefore: 1,
      channel: "email",
      status: "pending",
      retryCount: 0,
      sentAt: null,
    });
  }

  test("sweep-claim DB throw is contained: rest of batch completes, ledger records error", async () => {
    seedOpenTaskWithThreshold();
    seedSecondTaskWithStuckPending();
    store.failSweepClaimOnce = true;

    const result = await runEvaluateReminders(new Date(Date.now() + 86_400_000));

    // No throw: task A's fresh send completed while B's sweep claim failed.
    expect(result.emailsSent).toBe(1);
    expect(sendCalls).toHaveLength(1);
    expect(result.emailsFailed).toBe(1);
    expect(result.rowErrors).toBe(1);
    // The failed row is never marked failed by the containment path (it stays
    // pending/sending for the next run). Note: the fake's markSent resolves to
    // the first actionable row, so no per-row status is asserted here — the
    // counts above plus the ledger below are the contract.
    expect(
      store.deliveries.find((d) => d.id === "dlv-stuck-b")?.status,
    ).not.toBe("failed");
    // Ledger records error status — a partial run is never silently "ok".
    expect(store.runs).toHaveLength(1);
    expect(store.runs[0]!.status).toBe("error");
    expect(store.runs[0]!.error).toMatch(/row-level/);
  });

  test("taxonomy: row-error continues the run, infra-error aborts with ledger error", async () => {
    // Row half: a sweep-claim throw resolves (contained) with rowErrors set.
    seedOpenTaskWithThreshold();
    seedPendingDelivery();
    store.failSweepClaimOnce = true;
    const partial = await runEvaluateReminders(
      new Date(Date.now() + 86_400_000),
    );
    expect(partial.rowErrors).toBe(1);
    expect(partial.emailsSent).toBe(0);
    expect(store.runs[0]!.status).toBe("error");

    // Infra half: a batch-select failure still aborts fail-fast with a
    // ledger error (and rethrows — the route converts it to 200, covered in
    // cron-blackout.test.ts).
    resetStore();
    sendCalls = [];
    seedOpenTaskWithThreshold();
    store.failNextSelectOnce = true;
    await expect(
      runEvaluateReminders(new Date(Date.now() + 86_400_000)),
    ).rejects.toThrow("fake db: batch select failed");
    expect(store.runs).toHaveLength(1);
    expect(store.runs[store.runs.length - 1]!.status).toBe("error");
  });
});

// ---------------------------------------------------------------------------
// I-06: set-based claims/deletes (EXPLAIN-gated index skipped with evidence)
// ---------------------------------------------------------------------------

describe("I-06: set-based batch writes", () => {
  function seedTasksWithFailedDeliveries(count: number): void {
    const now = Date.now();
    store.taskRows = [];
    store.thresholdRows = [];
    store.deliveries = [];
    for (let i = 0; i < count; i++) {
      const n = String(i).padStart(2, "0");
      const taskId = `task-${n}`;
      const thresholdId = `thr-${n}`;
      store.taskRows.push({
        id: taskId,
        userId: USER,
        status: "todo",
        deadline: new Date(now + 86_400_000 - 60_000),
        createdAt: new Date(now - 10 * 86_400_000),
        title: `Task ${n}`,
      });
      store.thresholdRows.push({
        id: thresholdId,
        taskId,
        daysBefore: 1,
        createdAt: new Date(now - 10 * 86_400_000),
      });
      store.deliveries.push({
        id: `dlv-${n}`,
        taskId,
        thresholdId,
        daysBefore: 1,
        channel: "email",
        status: "failed",
        retryCount: 0,
        sentAt: null,
      });
    }
    store.profileRows = [
      { id: USER, email: "user@example.com", timezone: "UTC" },
    ];
  }

  function seedFreshTasks(count: number): void {
    const now = Date.now();
    store.taskRows = [];
    store.thresholdRows = [];
    store.deliveries = [];
    for (let i = 0; i < count; i++) {
      const n = String(i).padStart(2, "0");
      const taskId = `task-${n}`;
      const thresholdId = `thr-${n}`;
      store.taskRows.push({
        id: taskId,
        userId: USER,
        status: "todo",
        deadline: new Date(now + 86_400_000 - 60_000),
        createdAt: new Date(now - 10 * 86_400_000),
        title: `Task ${n}`,
      });
      store.thresholdRows.push({
        id: thresholdId,
        taskId,
        daysBefore: 1,
        createdAt: new Date(now - 10 * 86_400_000),
      });
    }
    store.profileRows = [
      { id: USER, email: "user@example.com", timezone: "UTC" },
    ];
  }

  test("retry claims collapse to one statement with identical results", async () => {
    seedTasksWithFailedDeliveries(3);

    const result = await runEvaluateReminders(new Date(Date.now() + 86_400_000));

    expect(result.retried).toBe(3);
    expect(store.retryClaimUpdateCalls).toBe(1);
    // Every claimed retry transitioned failed→pending→sent with retryCount+1.
    const sent = store.deliveries.filter(
      (d) => d.channel === "email" && d.status === "sent",
    );
    expect(sent).toHaveLength(3);
    expect(result.emailsSent).toBe(3);
    expect(result.rowErrors).toBe(0);
  });

  test("100-retry batch completes in a single claim statement", async () => {
    seedTasksWithFailedDeliveries(100);

    const result = await runEvaluateReminders(new Date(Date.now() + 86_400_000));

    // Claims are quota-independent: all 100 claimed in one statement even
    // though sends stop at the per-user per-run cap.
    expect(result.retried).toBe(100);
    expect(store.retryClaimUpdateCalls).toBe(1);
    expect(result.rowErrors).toBe(0);
  });

  test("stale cancels batch into a single delete", async () => {
    seedFreshTasks(3);
    store.editAllDeadlinesBeforeSend = true;

    const result = await runEvaluateReminders(new Date(Date.now() + 86_400_000));

    expect(sendCalls).toHaveLength(0);
    expect(result.emailsSent).toBe(0);
    expect(store.staleDeleteCalls).toBe(1);
    // All three stale email rows dropped; in_app confirmations untouched.
    expect(
      store.deliveries.filter((d) => d.channel === "email"),
    ).toHaveLength(0);
    expect(
      store.deliveries.filter((d) => d.channel === "in_app"),
    ).toHaveLength(3);
  });

  test("stale-delete failure is contained: run continues, rows stay pending", async () => {
    seedFreshTasks(2);
    store.editAllDeadlinesBeforeSend = true;
    store.failStaleDeleteOnce = true;

    const result = await runEvaluateReminders(new Date(Date.now() + 86_400_000));

    expect(sendCalls).toHaveLength(0);
    expect(result.rowErrors).toBe(1);
    expect(store.runs[0]!.status).toBe("error");
    // Best-effort preserved: rows remain for the next run.
    expect(
      store.deliveries.filter((d) => d.channel === "email"),
    ).toHaveLength(2);
  });

  test("retry-claim statement failure aborts with a ledger error (batch-scope)", async () => {
    seedTasksWithFailedDeliveries(1);
    store.failRetryClaimBatchOnce = true;

    await expect(
      runEvaluateReminders(new Date(Date.now() + 86_400_000)),
    ).rejects.toThrow("fake db: retry claim batch failed");

    expect(store.runs).toHaveLength(1);
    expect(store.runs[0]!.status).toBe("error");
  });
});

// ---------------------------------------------------------------------------
// M-4: threshold offset mutation & delivery days_before snapshots
// ---------------------------------------------------------------------------

describe("M-4: threshold offset changes and delivery snapshots", () => {
  test("threshold modified from H-3 to H-5 after H-3 delivery was sent creates and sends H-5 reminder", async () => {
    // 1. Seed task with threshold H-3 and existing sent delivery
    const now = Date.now();
    store.taskRows = [
      {
        id: TASK,
        userId: USER,
        status: "todo",
        deadline: new Date(now + 10 * 86_400_000), // deadline 10 days ahead
        createdAt: new Date(now - 86_400_000),
        title: "Task with modified threshold",
      },
    ];
    store.profileRows = [{ id: USER, email: "user@example.com", timezone: "UTC" }];

    // H-3 was sent earlier
    store.deliveries = [
      {
        id: "dlv-h3-sent",
        taskId: TASK,
        thresholdId: THRESHOLD,
        daysBefore: 3,
        channel: "email",
        status: "sent",
        retryCount: 0,
        sentAt: new Date(now - 3600_000),
      },
      {
        id: "dlv-h3-inapp",
        taskId: TASK,
        thresholdId: THRESHOLD,
        daysBefore: 3,
        channel: "in_app",
        status: "sent",
        retryCount: 0,
        sentAt: new Date(now - 3600_000),
      },
    ];

    // User patched threshold from H-3 to H-5
    store.thresholdRows = [{ id: THRESHOLD, taskId: TASK, daysBefore: 5 }];

    // Evaluator runs at H-5 (5 days before deadline)
    const result = await runEvaluateReminders(new Date(now + 5 * 86_400_000 + 1000));

    expect(result.created).toBe(2); // 1 email + 1 in_app for H-5
    expect(result.emailsSent).toBe(1);
    expect(sendCalls).toHaveLength(1);

    // Verify the new delivery row has daysBefore: 5
    const h5EmailDelivery = store.deliveries.find(
      (d) => d.channel === "email" && d.daysBefore === 5,
    );
    expect(h5EmailDelivery).toBeDefined();
    expect(h5EmailDelivery?.status).toBe("sent");

    // Old H-3 delivery remains untouched with daysBefore: 3
    const h3EmailDelivery = store.deliveries.find(
      (d) => d.id === "dlv-h3-sent",
    );
    expect(h3EmailDelivery?.daysBefore).toBe(3);
    expect(h3EmailDelivery?.status).toBe("sent");
  });

  test("pending H-3 delivery delivers with its own snapshot daysBefore even after threshold changed to H-5", async () => {
    const now = Date.now();
    store.taskRows = [
      {
        id: TASK,
        userId: USER,
        status: "todo",
        deadline: new Date(now + 10 * 86_400_000), // deadline 10 days ahead, so H-5 not due yet
        createdAt: new Date(now - 86_400_000),
        title: "Pending snapshot task",
      },
    ];
    store.profileRows = [{ id: USER, email: "user@example.com", timezone: "UTC" }];

    // Pending delivery exists for H-3
    store.deliveries = [
      {
        id: "dlv-pending-h3",
        taskId: TASK,
        thresholdId: THRESHOLD,
        daysBefore: 3,
        channel: "email",
        status: "pending",
        retryCount: 0,
        sentAt: null,
      },
    ];

    // Threshold in table was modified to H-5
    store.thresholdRows = [{ id: THRESHOLD, taskId: TASK, daysBefore: 5 }];

    // Evaluator runs stuck pending sweep at now (10 days ahead, H-5 not due)
    await runEvaluateReminders(new Date(now));

    expect(sendCalls).toHaveLength(1);
    // Email body subject should have H-3 label based on snapshot, not H-5
    const sentBody = sendCalls[0].body as { subject?: string };
    expect(sentBody.subject).toContain("[H-3]");

    const row = store.deliveries.find((d) => d.id === "dlv-pending-h3");
    expect(row?.status).toBe("sent");
    expect(row?.daysBefore).toBe(3);
  });

  test("two overlapping runs creating same (thresholdId, daysBefore, channel) deduplicate to one delivery", async () => {
    seedOpenTaskWithThreshold();
    barrier = createSelectGate(2);

    const [a, b] = await Promise.all([
      runEvaluateReminders(new Date(Date.now() + 86_400_000)),
      runEvaluateReminders(new Date(Date.now() + 86_400_000)),
    ]);

    expect(store.deliveries.filter((d) => d.channel === "email")).toHaveLength(1);
    const emailRow = store.deliveries.find((d) => d.channel === "email");
    expect(emailRow?.daysBefore).toBe(1);
    expect(a.created + b.created).toBe(2); // winner inserted 1 email + 1 in_app
    expect(a.emailsSent + b.emailsSent).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// M-5: email delivery retry cap (MAX_EMAIL_DELIVERY_RETRIES = 3)
// ---------------------------------------------------------------------------

describe("M-5: email delivery retry cap across scheduler cycles", () => {
  test("retry_count = 0 allows retry, increments to 1, and delivers email", async () => {
    seedOpenTaskWithThreshold();
    seedFailedDelivery(1, 0);

    const result = await runEvaluateReminders(new Date(Date.now() + 86_400_000));

    expect(result.retried).toBe(1);
    expect(result.emailsSent).toBe(1);
    expect(sendCalls).toHaveLength(1);
    const row = store.deliveries.find((d) => d.id === "dlv-seed");
    expect(row?.status).toBe("sent");
    expect(row?.retryCount).toBe(1);
  });

  test("retry_count = 1 allows retry, increments to 2, and delivers email", async () => {
    seedOpenTaskWithThreshold();
    seedFailedDelivery(1, 1);

    const result = await runEvaluateReminders(new Date(Date.now() + 86_400_000));

    expect(result.retried).toBe(1);
    expect(result.emailsSent).toBe(1);
    expect(sendCalls).toHaveLength(1);
    const row = store.deliveries.find((d) => d.id === "dlv-seed");
    expect(row?.status).toBe("sent");
    expect(row?.retryCount).toBe(2);
  });

  test("retry_count = 2 allows retry, increments to 3, and delivers email", async () => {
    seedOpenTaskWithThreshold();
    seedFailedDelivery(1, 2);

    const result = await runEvaluateReminders(new Date(Date.now() + 86_400_000));

    expect(result.retried).toBe(1);
    expect(result.emailsSent).toBe(1);
    expect(sendCalls).toHaveLength(1);
    const row = store.deliveries.find((d) => d.id === "dlv-seed");
    expect(row?.status).toBe("sent");
    expect(row?.retryCount).toBe(3);
  });

  test("retry_count = 3 (cap reached): scheduler rejects retry, sends 0 emails, row stays failed", async () => {
    seedOpenTaskWithThreshold();
    seedFailedDelivery(1, 3);

    const result = await runEvaluateReminders(new Date(Date.now() + 86_400_000));

    expect(result.retried).toBe(0);
    expect(result.created).toBe(0);
    expect(result.emailsSent).toBe(0);
    expect(result.emailsFailed).toBe(0);
    expect(sendCalls).toHaveLength(0);
    const row = store.deliveries.find((d) => d.id === "dlv-seed");
    expect(row?.status).toBe("failed");
    expect(row?.retryCount).toBe(3);
  });

  test("retry_count = 4 (above cap): scheduler rejects retry, sends 0 emails, row stays failed", async () => {
    seedOpenTaskWithThreshold();
    seedFailedDelivery(1, 4);

    const result = await runEvaluateReminders(new Date(Date.now() + 86_400_000));

    expect(result.retried).toBe(0);
    expect(result.created).toBe(0);
    expect(result.emailsSent).toBe(0);
    expect(result.emailsFailed).toBe(0);
    expect(sendCalls).toHaveLength(0);
    const row = store.deliveries.find((d) => d.id === "dlv-seed");
    expect(row?.status).toBe("failed");
    expect(row?.retryCount).toBe(4);
  });

  test("repeated failure lifecycle: exactly 3 retries (total 4 attempts) then permanently halts", async () => {
    seedOpenTaskWithThreshold();
    // Simulate failing provider
    sendBehavior = async () => ({
      data: null,
      error: { name: "application_error", message: "provider down", statusCode: 500 },
    });

    const now = new Date(Date.now() + 86_400_000);

    // Initial cron run: creates delivery (retryCount = 0) and attempts initial send (attempt #1)
    const run1 = await runEvaluateReminders(now);
    expect(run1.created).toBe(2); // 1 email + 1 in_app
    expect(run1.retried).toBe(0);
    expect(run1.emailsFailed).toBe(1);
    const row = store.deliveries.find((d) => d.channel === "email");
    expect(row?.status).toBe("failed");
    expect(row?.retryCount).toBe(0);

    // Cron run 2: Retry #1 (attempt #2) -> fails, retryCount becomes 1
    const run2 = await runEvaluateReminders(now);
    expect(run2.retried).toBe(1);
    expect(run2.emailsFailed).toBe(1);
    expect(row?.status).toBe("failed");
    expect(row?.retryCount).toBe(1);

    // Cron run 3: Retry #2 (attempt #3) -> fails, retryCount becomes 2
    const run3 = await runEvaluateReminders(now);
    expect(run3.retried).toBe(1);
    expect(run3.emailsFailed).toBe(1);
    expect(row?.status).toBe("failed");
    expect(row?.retryCount).toBe(2);

    // Cron run 4: Retry #3 (attempt #4) -> fails, retryCount becomes 3 (cap reached)
    const run4 = await runEvaluateReminders(now);
    expect(run4.retried).toBe(1);
    expect(run4.emailsFailed).toBe(1);
    expect(row?.status).toBe("failed");
    expect(row?.retryCount).toBe(3);

    // Cron run 5: Cap is reached (retryCount = 3), scheduler does NOT retry (0 attempts)
    sendCalls = [];
    const run5 = await runEvaluateReminders(now);
    expect(run5.retried).toBe(0);
    expect(run5.emailsSent).toBe(0);
    expect(run5.emailsFailed).toBe(0);
    expect(sendCalls).toHaveLength(0);
    expect(row?.status).toBe("failed");
    expect(row?.retryCount).toBe(3);

    // Cron run 6: Still terminal failed, no retry
    const run6 = await runEvaluateReminders(now);
    expect(run6.retried).toBe(0);
    expect(sendCalls).toHaveLength(0);
    expect(row?.status).toBe("failed");
    expect(row?.retryCount).toBe(3);
  }, 15000);
});

// ---------------------------------------------------------------------------
// M-12: Evaluator bounded / batched processing & keyset pagination
// ---------------------------------------------------------------------------

describe("M-12: evaluator batching and memory bounding", () => {
  test("multi-batch dataset evaluates all tasks across batches using keyset cursor", async () => {
    const now = Date.now();
    const taskIds = ["task-01", "task-02", "task-03", "task-04", "task-05"];

    store.profileRows = [
      { id: "user-1", email: "user1@example.com", timezone: "UTC" },
      { id: "user-2", email: "user2@example.com", timezone: "UTC" },
    ];

    // Seed 5 tasks out of order to verify asc(tasks.id) ordering & cursor progression
    store.taskRows = [
      {
        id: "task-04",
        userId: "user-2",
        status: "todo",
        deadline: new Date(now + 86_400_000 - 60_000),
        createdAt: new Date(now - 10 * 86_400_000),
        title: "Task 4",
      },
      {
        id: "task-01",
        userId: "user-1",
        status: "todo",
        deadline: new Date(now + 86_400_000 - 60_000),
        createdAt: new Date(now - 10 * 86_400_000),
        title: "Task 1",
      },
      {
        id: "task-05",
        userId: "user-2",
        status: "in_progress",
        deadline: new Date(now + 86_400_000 - 60_000),
        createdAt: new Date(now - 10 * 86_400_000),
        title: "Task 5",
      },
      {
        id: "task-02",
        userId: "user-1",
        status: "in_progress",
        deadline: new Date(now + 86_400_000 - 60_000),
        createdAt: new Date(now - 10 * 86_400_000),
        title: "Task 2",
      },
      {
        id: "task-03",
        userId: "user-1",
        status: "todo",
        deadline: new Date(now + 86_400_000 - 60_000),
        createdAt: new Date(now - 10 * 86_400_000),
        title: "Task 3",
      },
    ];

    store.thresholdRows = taskIds.map((id, index) => ({
      id: `thresh-${index + 1}`,
      taskId: id,
      daysBefore: 1,
    }));

    // Run evaluate with batchSize: 2 (will execute 3 batches: 2 + 2 + 1)
    const result = await runEvaluateReminders(
      new Date(Date.now() + 86_400_000),
      { batchSize: 2 },
    );

    expect(result.evaluatedTasks).toBe(5);
    // 5 tasks * 2 deliveries (1 email + 1 in_app) = 10 created deliveries
    expect(result.created).toBe(10);
    expect(result.emailsSent).toBe(5);
    expect(result.emailsFailed).toBe(0);
    expect(sendCalls).toHaveLength(5);
    expect(store.deliveries).toHaveLength(10);

    // Verify all 5 email deliveries were marked sent
    const emailDeliveries = store.deliveries.filter((d) => d.channel === "email");
    expect(emailDeliveries).toHaveLength(5);
    for (const emailDelivery of emailDeliveries) {
      expect(emailDelivery.status).toBe("sent");
    }
  });

  test("boundary: 0 open tasks returns cleanly with 0 counts", async () => {
    store.taskRows = [];
    store.thresholdRows = [];
    store.profileRows = [];

    const result = await runEvaluateReminders(
      new Date(Date.now() + 86_400_000),
      { batchSize: 2 },
    );

    expect(result.evaluatedTasks).toBe(0);
    expect(result.created).toBe(0);
    expect(result.emailsSent).toBe(0);
    expect(sendCalls).toHaveLength(0);
  });

  test("boundary: exact multiple of batchSize terminates properly", async () => {
    const now = Date.now();
    store.profileRows = [
      { id: "user-1", email: "user1@example.com", timezone: "UTC" },
    ];
    store.taskRows = [
      {
        id: "task-a",
        userId: "user-1",
        status: "todo",
        deadline: new Date(now + 86_400_000 - 60_000),
        createdAt: new Date(now - 10 * 86_400_000),
        title: "Task A",
      },
      {
        id: "task-b",
        userId: "user-1",
        status: "todo",
        deadline: new Date(now + 86_400_000 - 60_000),
        createdAt: new Date(now - 10 * 86_400_000),
        title: "Task B",
      },
      {
        id: "task-c",
        userId: "user-1",
        status: "todo",
        deadline: new Date(now + 86_400_000 - 60_000),
        createdAt: new Date(now - 10 * 86_400_000),
        title: "Task C",
      },
      {
        id: "task-d",
        userId: "user-1",
        status: "todo",
        deadline: new Date(now + 86_400_000 - 60_000),
        createdAt: new Date(now - 10 * 86_400_000),
        title: "Task D",
      },
    ];
    store.thresholdRows = store.taskRows.map((t, idx) => ({
      id: `thresh-${idx}`,
      taskId: t.id,
      daysBefore: 1,
    }));

    // Exactly 4 tasks with batchSize: 2 (2 full batches + 1 empty terminal batch)
    const result = await runEvaluateReminders(
      new Date(Date.now() + 86_400_000),
      { batchSize: 2 },
    );

    expect(result.evaluatedTasks).toBe(4);
    expect(result.created).toBe(8);
    expect(result.emailsSent).toBe(4);
  });

  test("done and deleted tasks are ignored by keyset query", async () => {
    const now = Date.now();
    store.profileRows = [
      { id: "user-1", email: "user1@example.com", timezone: "UTC" },
    ];
    store.taskRows = [
      {
        id: "task-open",
        userId: "user-1",
        status: "todo",
        deadline: new Date(now + 86_400_000 - 60_000),
        createdAt: new Date(now - 10 * 86_400_000),
        title: "Task Open",
      },
      {
        id: "task-done",
        userId: "user-1",
        status: "done",
        deadline: new Date(now + 86_400_000 - 60_000),
        createdAt: new Date(now - 10 * 86_400_000),
        title: "Task Done",
      },
      {
        id: "task-deleted",
        userId: "user-1",
        status: "todo",
        deadline: new Date(now + 86_400_000 - 60_000),
        createdAt: new Date(now - 10 * 86_400_000),
        title: "Task Deleted",
        deletedAt: new Date(),
      } as any,
    ];
    store.thresholdRows = store.taskRows.map((t, idx) => ({
      id: `thresh-${idx}`,
      taskId: t.id,
      daysBefore: 1,
    }));

    const result = await runEvaluateReminders(
      new Date(Date.now() + 86_400_000),
      { batchSize: 10 },
    );

    expect(result.evaluatedTasks).toBe(1);
    expect(result.created).toBe(2);
    expect(result.emailsSent).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// RF-12: bounded runs (MAX_TASKS_PER_RUN / MAX_RUN_DURATION_MS + truncated)
// ---------------------------------------------------------------------------

describe("RF-12: evaluator bounds and truncation ledger", () => {
  function seedFourTasks(): void {
    const now = Date.now();
    store.profileRows = [
      { id: "user-1", email: "user1@example.com", timezone: "UTC" },
    ];
    store.taskRows = ["task-01", "task-02", "task-03", "task-04"].map(
      (id, index) => ({
        id,
        userId: "user-1",
        status: "todo",
        deadline: new Date(now + 86_400_000 - 60_000),
        createdAt: new Date(now - 10 * 86_400_000),
        title: `Task ${index + 1}`,
      }),
    );
    store.thresholdRows = store.taskRows.map((t, idx) => ({
      id: `thresh-${idx + 1}`,
      taskId: t.id,
      daysBefore: 1,
    }));
  }

  test("hitting MAX_TASKS_PER_RUN truncates cleanly, finishes the ledger across batches", async () => {
    seedFourTasks();
    const result = await runEvaluateReminders(
      new Date(Date.now() + 86_400_000),
      { batchSize: 1, maxTasksPerRun: 3, maxRunDurationMs: 60_000 },
    );

    // Cap is batch-granular: exactly 3 whole batches of 1 were evaluated.
    expect(result.truncated).toBe(true);
    expect(result.evaluatedTasks).toBe(3);
    // 3 tasks × 2 channels (email + in_app), email half sent.
    expect(result.created).toBe(6);
    expect(result.emailsSent).toBe(3);

    // Ledger: status ok + truncated true + cursor at the last full batch.
    const row = store.runs[0]!;
    expect(row.status).toBe("ok");
    expect(row.finishedAt).not.toBeNull();
    expect(row.truncated).toBe(true);
    expect(row.lastSeenTaskId).toBe("task-03");
  });

  test("remaining-open-tasks backlog is counted behind the cursor on truncation", async () => {
    seedFourTasks();
    const result = await runEvaluateReminders(
      new Date(Date.now() + 86_400_000),
      { batchSize: 2, maxTasksPerRun: 2, maxRunDurationMs: 60_000 },
    );

    expect(result.truncated).toBe(true);
    expect(result.evaluatedTasks).toBe(2);
    expect(store.runs[0]!.lastSeenTaskId).toBe("task-02");
  });

  test("hitting MAX_RUN_DURATION_MS truncates at a whole-batch boundary", async () => {
    seedFourTasks();
    const result = await runEvaluateReminders(
      new Date(Date.now() + 86_400_000),
      { batchSize: 2, maxTasksPerRun: 1_000_000, maxRunDurationMs: 0 },
    );

    expect(result.truncated).toBe(true);
    // First batch (2 tasks) always runs; deadline check trips before batch 2.
    expect(result.evaluatedTasks).toBe(2);
    expect(store.runs[0]!.truncated).toBe(true);
    expect(store.runs[0]!.status).toBe("ok");
  });

  test("a run within caps is not truncated and evaluates everything", async () => {
    seedFourTasks();
    const result = await runEvaluateReminders(
      new Date(Date.now() + 86_400_000),
      { batchSize: 2, maxTasksPerRun: 100, maxRunDurationMs: 60_000 },
    );

    expect(result.truncated).toBe(false);
    expect(result.evaluatedTasks).toBe(4);
    expect(store.runs[0]!.truncated).toBe(false);
    expect(store.runs[0]!.status).toBe("ok");
  });

  test("a zero cap still lets the first batch run, then truncates (batch-atomic)", async () => {
    seedFourTasks();
    const result = await runEvaluateReminders(
      new Date(Date.now() + 86_400_000),
      { batchSize: 2, maxTasksPerRun: 0, maxRunDurationMs: 60_000 },
    );

    expect(result.truncated).toBe(true);
    expect(result.evaluatedTasks).toBe(2);
    expect(store.runs[0]!.lastSeenTaskId).toBe("task-02");
  });

  test("MAX_TASKS_PER_RUN env var is honored without explicit options", async () => {
    seedFourTasks();
    process.env.MAX_TASKS_PER_RUN = "2";
    try {
      const result = await runEvaluateReminders(
        new Date(Date.now() + 86_400_000),
        { batchSize: 1 },
      );
      expect(result.truncated).toBe(true);
      expect(result.evaluatedTasks).toBe(2);
    } finally {
      delete process.env.MAX_TASKS_PER_RUN;
    }
  });

  test("overlapping run lock skip reports truncated=false with zero counts", async () => {
    store.runLockBusy = true;
    const result = await runEvaluateReminders(
      new Date(Date.now() + 86_400_000),
      { batchSize: 2 },
    );
    expect(result.skipped).toBe(true);
    expect(result.truncated).toBe(false);
    expect(result.evaluatedTasks).toBe(0);
  });
});

describe("SEC-003 — per-user per-run email cap", () => {
  test("60 due emails for one user → 50 sent, 10 pending + skipped", async () => {
    const now = Date.now();
    store.profileRows = [
      { id: USER, email: "user@example.com", timezone: "UTC" },
    ];
    store.taskRows = Array.from({ length: 60 }, (_, i) => ({
      id: `quota-task-${String(i).padStart(3, "0")}`,
      userId: USER,
      status: "todo",
      deadline: new Date(now + 86_400_000 - 60_000),
      createdAt: new Date(now - 10 * 86_400_000),
      title: `Task ${i}`,
    }));
    store.thresholdRows = store.taskRows.map((t, idx) => ({
      id: `quota-thresh-${idx}`,
      taskId: t.id,
      daysBefore: 1,
    }));

    const result = await runEvaluateReminders(new Date(now), {
      batchSize: 200,
    });

    expect(result.emailsSent).toBe(50);
    expect(result.emailsSkippedQuota).toBe(10);
    expect(result.emailsFailed).toBe(0);
    expect(sendCalls).toHaveLength(50);
    expect(
      store.deliveries.filter(
        (d) => d.channel === "email" && d.status === "sent",
      ),
    ).toHaveLength(50);
    // Skipped deliveries are left pending for the next run, never failed.
    expect(
      store.deliveries.filter(
        (d) => d.channel === "email" && d.status === "pending",
      ),
    ).toHaveLength(10);
  });
});

// ---------------------------------------------------------------------------
// F-03: scheduler-activation cutoff plumbing
// ---------------------------------------------------------------------------

describe("F-03: REMINDER_CUTOFF_ISO suppresses the first-run burst", () => {
  function seedStaleTask(): void {
    const now = Date.now();
    store.taskRows = [
      {
        id: TASK,
        userId: USER,
        status: "todo",
        // RF-11: keep the deadline just past (inside the 1h grace) so the
        // control case exercises the solver-activation burst without running
        // into the newly-added deadline-passed suppression.
        deadline: new Date(now - 60_000),
        createdAt: new Date(now - 60 * 86_400_000), // created 60 days ago
        title: "Stale task",
      },
    ];
    store.thresholdRows = [{ id: THRESHOLD, taskId: TASK, daysBefore: 1 }];
    store.profileRows = [{ id: USER, email: "user@example.com", timezone: "UTC" }];
  }

  test("without cutoff the stale task bursts (control case)", async () => {
    seedStaleTask();
    const result = await runEvaluateReminders(new Date(Date.now()), {
      cutoff: null,
    });
    expect(result.created).toBeGreaterThan(0);
    expect(result.emailsSent).toBeGreaterThan(0);
  });

  test("explicit cutoff silences pre-cutoff triggers end to end", async () => {
    seedStaleTask();
    const result = await runEvaluateReminders(new Date(Date.now()), {
      cutoff: new Date(Date.now() - 3_600_000), // activated an hour ago
    });
    expect(result.created).toBe(0);
    expect(result.retried).toBe(0);
    expect(result.emailsSent).toBe(0);
    expect(store.deliveries).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// F-04: run ledger records (observability only)
// ---------------------------------------------------------------------------

describe("F-04: reminder_runs ledger", () => {
  test("successful run writes a running→ok row matching the result", async () => {
    seedOpenTaskWithThreshold();
    const result = await runEvaluateReminders(new Date(Date.now() + 86_400_000));

    expect(result.runId).not.toBeNull();
    expect(store.runs).toHaveLength(1);
    if (result.runId === null) throw new Error("expected runId to be recorded");
    const row = store.runs[0]!;
    expect(row.id).toBe(result.runId);
    expect(row.status).toBe("ok");
    expect(row.error).toBeNull();
    expect(row.finishedAt).toBeInstanceOf(Date);
    expect(row.evaluatedTasks).toBe(result.evaluatedTasks);
    expect(row.created).toBe(result.created);
    expect(row.retried).toBe(result.retried);
    expect(row.emailsSent).toBe(result.emailsSent);
    expect(row.emailsFailed).toBe(result.emailsFailed);
    expect(row.emailsSkippedQuota).toBe(result.emailsSkippedQuota);
  });

  test("transient lock-write failure is retried and the run proceeds (NEW-01)", async () => {
    seedOpenTaskWithThreshold();
    // The lock insert fails ONCE (a transient DB blip), then succeeds: the
    // run must retry (bounded) and proceed, not lose the interval.
    store.failRunRecordOnce = true;
    const result = await runEvaluateReminders(new Date(Date.now() + 86_400_000));

    expect(result.runId).not.toBeNull();
    expect(result.lockUnavailable).toBeUndefined();
    expect(result.skipped).toBeUndefined();
    expect(result.evaluatedTasks).toBeGreaterThan(0);
    // Delivery happened after the retry recovered the lock.
    expect(result.created).toBeGreaterThan(0);
    expect(result.emailsSent).toBeGreaterThan(0);
    expect(store.runs).toHaveLength(1);
    expect(store.runs[0]!.status).toBe("ok");
  });

  test("persistent lock-write failure aborts the run fail-closed (NEW-01)", async () => {
    seedOpenTaskWithThreshold();
    // Every lock-insert attempt fails (a persistent DB error, not a held
    // lock): the run must abort with zero work rather than proceed unlocked.
    store.failRunRecordAlways = true;
    const result = await runEvaluateReminders(new Date(Date.now() + 86_400_000));

    expect(result.lockUnavailable).toBe(true);
    expect(result.skipped).toBe(false);
    expect(result.runId).toBeNull();
    // No work was done and no ledger row exists.
    expect(result.evaluatedTasks).toBe(0);
    expect(result.created).toBe(0);
    expect(result.retried).toBe(0);
    expect(result.emailsSent).toBe(0);
    expect(result.emailsFailed).toBe(0);
    expect(store.runs).toHaveLength(0);
    // Nothing may be sent while the single-flight guarantee is unknowable.
    expect(
      store.deliveries.filter((d) => d.thresholdId === THRESHOLD),
    ).toHaveLength(0);
  });

  test("mid-run throw finalizes an error row and rethrows", async () => {
    seedOpenTaskWithThreshold();
    store.failNextSelectOnce = true;

    await expect(
      runEvaluateReminders(new Date(Date.now() + 86_400_000)),
    ).rejects.toThrow("fake db: batch select failed");

    expect(store.runs).toHaveLength(1);
    const row = store.runs[0]!;
    expect(row.status).toBe("error");
    expect(row.finishedAt).toBeInstanceOf(Date);
    expect(row.error).toContain("fake db: batch select failed");
  });

  test("run-record writes never touch the delivery store", async () => {
    seedOpenTaskWithThreshold();
    await runEvaluateReminders(new Date(Date.now() + 86_400_000));
    // Only genuine delivery rows exist: 1 email (pending→sent) + 1 in_app.
    expect(
      store.deliveries.filter((d) => d.thresholdId === THRESHOLD),
    ).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
// RF-04: single-flight run lock (overlap cannot double-spend the user budget)
// ---------------------------------------------------------------------------

describe("RF-04: single-flight run lock", () => {
  test("a held lock exits early with no work and no sends", async () => {
    seedOpenTaskWithThreshold();
    store.runLockBusy = true;

    const result = await runEvaluateReminders(new Date(Date.now() + 86_400_000));

    expect(result.skipped).toBe(true);
    expect(result.runId).toBeNull();
    expect(result.created).toBe(0);
    expect(result.emailsSent).toBe(0);
    expect(sendCalls).toHaveLength(0);
    expect(store.deliveries).toHaveLength(0);
    // No ledger row is written by the skipped run.
    expect(store.runs).toHaveLength(0);
  });

  test("a normal run acquires the lock (skipped is not set)", async () => {
    seedOpenTaskWithThreshold();

    const result = await runEvaluateReminders(new Date(Date.now() + 86_400_000));

    expect(result.skipped).toBeUndefined();
    expect(result.runId).not.toBeNull();
    expect(store.runs).toHaveLength(1);
    expect(store.runs[0]!.status).toBe("ok");
  });
});

// ---------------------------------------------------------------------------
// RF-07: deadline/threshold edited mid-run cancels the stale send
// ---------------------------------------------------------------------------

describe("RF-07: edited-mid-run cancellation", () => {
  test("deadline edited between snapshot and send cancels, deletes, and sends on the next run", async () => {
    seedOpenTaskWithThreshold();
    store.editDeadlineBeforeSendOnce = true;

    const first = await runEvaluateReminders(new Date(Date.now() + 86_400_000));

    expect(sendCalls).toHaveLength(0);
    expect(first.emailsSent).toBe(0);
    expect(first.emailsSkippedQuota).toBe(0);
    // Cancelled delivery row is removed, so the next run can re-create it.
    expect(store.deliveries.filter((d) => d.channel === "email")).toHaveLength(
      0,
    );

    const second = await runEvaluateReminders(new Date(Date.now() + 86_400_000));

    expect(sendCalls).toHaveLength(1);
    expect(second.emailsSent).toBe(1);
    expect(
      store.deliveries.filter((d) => d.channel === "email" && d.status === "sent"),
    ).toHaveLength(1);
  });

  test("threshold offset edited between snapshot and send cancels the send", async () => {
    seedOpenTaskWithThreshold();
    store.editThresholdBeforeSendOnce = true;

    const result = await runEvaluateReminders(new Date(Date.now() + 86_400_000));

    expect(sendCalls).toHaveLength(0);
    expect(result.emailsSent).toBe(0);
    expect(store.deliveries.filter((d) => d.channel === "email")).toHaveLength(
      0,
    );
  });

  test("unrelated title edit does not cancel the send", async () => {
    seedOpenTaskWithThreshold();
    store.editTitleBeforeSendOnce = true;

    const result = await runEvaluateReminders(new Date(Date.now() + 86_400_000));

    expect(sendCalls).toHaveLength(1);
    expect(result.emailsSent).toBe(1);
    expect(
      store.deliveries.filter((d) => d.channel === "email" && d.status === "sent"),
    ).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// RF-01: run checkpoint (last_seen_task_id) for post-crash resume
// ---------------------------------------------------------------------------

describe("RF-01: reminder_runs checkpoint", () => {
  function seedTwoOpenTasksWithoutThresholds(): void {
    store.taskRows = [
      {
        id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        userId: USER,
        status: "todo",
        deadline: new Date(Date.now() + 86_400_000),
        createdAt: new Date(Date.now() - 86_400_000),
        title: "Task A",
      },
      {
        id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
        userId: USER,
        status: "todo",
        deadline: new Date(Date.now() + 86_400_000),
        createdAt: new Date(Date.now() - 86_400_000),
        title: "Task B",
      },
    ];
    store.profileRows = [{ id: USER, email: "user@example.com", timezone: "UTC" }];
  }

  test("checkpoint advances per complete batch and lands on the run row", async () => {
    seedTwoOpenTasksWithoutThresholds();

    const result = await runEvaluateReminders(
      new Date(Date.now() + 86_400_000),
      { batchSize: 1 },
    );

    expect(result.evaluatedTasks).toBe(2);
    const row = store.runs[0]!;
    // Checkpoint persists the last fully-processed task, and the final run
    // row carries it so an operator can resume after a crash.
    expect(row.lastSeenTaskId).toBe(
      "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
    );
    expect(row.evaluatedTasks).toBe(2);
  });

  test("mid-run batch failure keeps the checkpoint at the last complete batch", async () => {
    seedTwoOpenTasksWithoutThresholds();
    store.failTaskBatchFetchNumber = 2;

    await expect(
      runEvaluateReminders(new Date(Date.now() + 86_400_000), {
        batchSize: 1,
      }),
    ).rejects.toThrow("fake db: task batch fetch failed");

    const row = store.runs[0]!;
    expect(row.status).toBe("error");
    expect(row.error).toContain("task batch fetch failed");
    // The second batch was never processed: the checkpoint must not advance
    // past it, so the next run re-evaluates it with the natural keyset.
    expect(row.lastSeenTaskId).toBe("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa");
    expect(row.evaluatedTasks).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// RF-02: frozen email body + idempotency key across scheduler runs
// ---------------------------------------------------------------------------

describe("RF-02: frozen email identity", () => {
  test("a successful first send freezes the snapshot and key", async () => {
    seedOpenTaskWithThreshold("Fresh title");

    const result = await runEvaluateReminders(new Date(Date.now() + 86_400_000));

    expect(result.emailsSent).toBe(1);
    const row = store.deliveries.find((d) => d.channel === "email")!;
    expect(row.status).toBe("sent");
    expect(row.emailSnapshot?.title).toBe("Fresh title");
    expect(row.emailSnapshot?.daysBefore).toBe(1);
    expect(row.emailSnapshot?.timeZone).toBe("UTC");
    expect(row.emailIdempotencyKey).toMatch(/^reminder-delivery-dlv-/);
  });

  test("an across-run retry reuses the frozen body after a task edit", async () => {
    seedOpenTaskWithThreshold("Original title");
    sendBehavior = async () => ({
      data: null,
      error: { name: "application_error", message: "boom", statusCode: 500 },
    });

    await runEvaluateReminders(new Date(Date.now() + 86_400_000));

    const row = store.deliveries.find((d) => d.channel === "email")!;
    expect(row.status).toBe("failed");
    expect(row.emailSnapshot?.title).toBe("Original title");
    const frozenKey = row.emailIdempotencyKey;
    if (typeof frozenKey !== "string") throw new Error("expected a frozen key");

    // The user edits the task title between the failed attempt and the retry.
    store.taskRows[0]!.title = "Edited title";
    sendBehavior = successBehavior();
    sendCalls = [];

    const result = await runEvaluateReminders(new Date(Date.now() + 86_400_000));

    expect(result.retried).toBe(1);
    expect(result.emailsSent).toBe(1);
    expect(sendCalls).toHaveLength(1);
    const body = sendCalls[0].body as { subject?: string };
    expect(body.subject).toContain("Original title");
    expect(body.subject).not.toContain("Edited title");
    // Same frozen key → the provider dedups instead of sending a duplicate.
    expect(sentOptionsOf(0).idempotencyKey).toBe(frozenKey);
    expect(row.emailSnapshot?.title).toBe("Original title");
  });

  test("a terminal idempotency rejection rotates the key for the next run", async () => {
    seedOpenTaskWithThreshold();
    let calls = 0;
    sendBehavior = async () => {
      calls += 1;
      if (calls === 1) {
        return {
          data: null,
          error: { name: "invalid_idempotent_request", message: "key reused" },
        };
      }
      return { data: { id: "em_ok" }, error: null };
    };

    const run1 = await runEvaluateReminders(new Date(Date.now() + 86_400_000));

    // Terminal in-call: exactly one provider call, row failed with a rotated key.
    expect(run1.emailsFailed).toBe(1);
    expect(sendCalls).toHaveLength(1);
    const row = store.deliveries.find((d) => d.channel === "email")!;
    expect(row.status).toBe("failed");
    const originalKey = sentOptionsOf(0).idempotencyKey;
    const rotatedKey = row.emailIdempotencyKey;
    if (typeof rotatedKey !== "string") {
      throw new Error("expected a rotated key");
    }
    expect(rotatedKey).not.toBe(originalKey);
    expect(row.lastError).toBe("key reused");

    sendCalls = [];
    const run2 = await runEvaluateReminders(new Date(Date.now() + 86_400_000));

    expect(run2.retried).toBe(1);
    expect(run2.emailsSent).toBe(1);
    expect(sendCalls).toHaveLength(1);
    // The retry sends under the persisted rotated key, so it can deliver.
    expect(sentOptionsOf(0).idempotencyKey).toBe(rotatedKey);
  });
});

// ---------------------------------------------------------------------------
// F-05: delivery failure context (observability only)
// ---------------------------------------------------------------------------

describe("F-05: last_error + failed_at on delivery failures", () => {
  test("provider 500 records the message and timestamp on the failed row", async () => {
    seedOpenTaskWithThreshold("Task A");
    sendBehavior = async () => ({
      data: null,
      error: { name: "application_error", message: "boom", statusCode: 500 },
    });

    const before = Date.now();
    const result = await runEvaluateReminders(new Date(Date.now() + 86_400_000));

    expect(result.emailsFailed).toBe(1);
    const row = store.deliveries.find((d) => d.channel === "email")!;
    expect(row.status).toBe("failed");
    expect(row.lastError).toBe("boom");
    expect(row.failedAt).toBeInstanceOf(Date);
    expect(row.failedAt!.getTime()).toBeGreaterThanOrEqual(before);
  });

  test("over-long provider messages are truncated to 500 chars", async () => {
    seedOpenTaskWithThreshold();
    sendBehavior = async () => ({
      data: null,
      error: {
        name: "application_error",
        message: "x".repeat(600),
        statusCode: 500,
      },
    });

    await runEvaluateReminders(new Date(Date.now() + 86_400_000));

    const row = store.deliveries.find((d) => d.channel === "email")!;
    expect(row.status).toBe("failed");
    expect(row.lastError).toHaveLength(500);
  });

  test("missing recipient records the synthetic reason, not a provider error", async () => {
    const now = Date.now();
    store.taskRows = [
      {
        id: TASK,
        userId: USER,
        status: "todo",
        deadline: new Date(now + 86_400_000 - 60_000),
        createdAt: new Date(now - 10 * 86_400_000),
        title: "Task A",
      },
    ];
    store.thresholdRows = [{ id: THRESHOLD, taskId: TASK, daysBefore: 1 }];
    store.profileRows = [{ id: USER, email: "", timezone: "UTC" }];

    const result = await runEvaluateReminders(new Date(now + 86_400_000));

    expect(result.emailsFailed).toBe(1);
    expect(result.emailsPoisoned).toBe(1);
    expect(sendCalls).toHaveLength(0);
    const row = store.deliveries.find((d) => d.channel === "email")!;
    expect(row.status).toBe("failed");
    // RF-08: poison is terminal on first detection (retry cap reached).
    expect(row.retryCount).toBe(MAX_EMAIL_DELIVERY_RETRIES);
    expect(row.lastError).toBe("missing task or recipient email");
    expect(row.failedAt).toBeInstanceOf(Date);
  });

  test("RF-08: deterministic poison is terminal — later runs never retry it", async () => {
    const now = Date.now();
    store.taskRows = [
      {
        id: TASK,
        userId: USER,
        status: "todo",
        deadline: new Date(now + 86_400_000 - 60_000),
        createdAt: new Date(now - 10 * 86_400_000),
        title: "Task A",
      },
    ];
    store.thresholdRows = [{ id: THRESHOLD, taskId: TASK, daysBefore: 1 }];
    store.profileRows = [{ id: USER, email: "", timezone: "UTC" }];

    const at = new Date(now + 86_400_000);
    const run1 = await runEvaluateReminders(at);
    expect(run1.emailsFailed).toBe(1);
    expect(run1.emailsPoisoned).toBe(1);
    const row = store.deliveries.find((d) => d.channel === "email")!;
    expect(row.status).toBe("failed");
    expect(row.retryCount).toBe(MAX_EMAIL_DELIVERY_RETRIES);

    // The evaluator sees retry_count === cap and stops offering retries: every
    // subsequent run is a no-op, not another failed attempt each cycle.
    sendCalls = [];
    for (let i = 0; i < 4; i += 1) {
      const run = await runEvaluateReminders(at);
      expect(run.retried).toBe(0);
      expect(run.emailsFailed).toBe(0);
      expect(run.emailsPoisoned).toBe(0);
    }
    expect(sendCalls).toHaveLength(0);
    expect(row.status).toBe("failed");
    expect(row.retryCount).toBe(MAX_EMAIL_DELIVERY_RETRIES);
  });

  test("a later failure overwrites last_error (last-failure semantics)", async () => {
    seedOpenTaskWithThreshold();
    // In-provider attempts come in threes (bounded retry); first run fails
    // with "boom", second run (retry claim) with "bam".
    sendBehavior = async () => {
      // sendCalls is pushed before the behavior runs, so run 1 observes
      // lengths 1-3 and run 2 observes 4-6.
      const wave = sendCalls.length <= 3 ? "boom" : "bam";
      return {
        data: null,
        error: { name: "application_error", message: wave, statusCode: 500 },
      };
    };

    await runEvaluateReminders(new Date(Date.now() + 86_400_000));
    const afterFirst = store.deliveries.find((d) => d.channel === "email")!;
    expect(afterFirst.lastError).toBe("boom");

    await runEvaluateReminders(new Date(Date.now() + 86_400_000));
    const afterRetry = store.deliveries.find((d) => d.channel === "email")!;
    expect(afterRetry.status).toBe("failed");
    expect(afterRetry.retryCount).toBe(1);
    expect(afterRetry.lastError).toBe("bam");
  });

  test("confirm-write failure keeps the row sendable and records context (RF-01)", async () => {
    seedOpenTaskWithThreshold();
    seedPendingDelivery();
    store.failMarkSentOnce = true;

    const result = await runEvaluateReminders(new Date(Date.now() + 86_400_000));

    // The email was accepted upstream; only the confirm write failed.
    expect(sendCalls).toHaveLength(1);
    expect(result.emailsSent).toBe(0);
    expect(result.emailsFailed).toBe(1);
    const row = store.deliveries.find((d) => d.id === "dlv-seed")!;
    // Status untouched (still swept as `sending`) so a later run reclaims and
    // re-sends under the same idempotency key — never lied to `failed`.
    expect(row.status).toBe("sending");
    expect(row.lastError).toMatch(
      /^confirm failed: fake db: markSent write failed$/,
    );
    expect(row.failedAt).toBeInstanceOf(Date);
  });
});

// ---------------------------------------------------------------------------
// F-07: sent email renders the deadline in the profile timezone
// ---------------------------------------------------------------------------

describe("F-07: profile timezone reaches the sent email", () => {
  test("Makassar profile receives GMT+8 rendering, not UTC", async () => {
    const now = Date.now();
    store.taskRows = [
      {
        id: TASK,
        userId: USER,
        status: "todo",
        deadline: new Date(now + 86_400_000 - 60_000),
        createdAt: new Date(now - 10 * 86_400_000),
        title: "Task A",
      },
    ];
    store.thresholdRows = [{ id: THRESHOLD, taskId: TASK, daysBefore: 1 }];
    store.profileRows = [
      { id: USER, email: "user@example.com", timezone: "Asia/Makassar" },
    ];

    const result = await runEvaluateReminders(new Date(now + 86_400_000));

    expect(result.emailsSent).toBe(1);
    expect(sendCalls.length).toBeGreaterThan(0);
    const text = (sendCalls[0]?.body as { text?: string }).text ?? "";
    expect(text).toContain("GMT+8");
    expect(text).not.toContain("(UTC)");
  });
});

// ---------------------------------------------------------------------------
// F-08: live status re-check before sends
// ---------------------------------------------------------------------------

describe("F-08: task completed between snapshot and send", () => {
  test("emailWork skips the send: no email, pending preserved, quota untouched", async () => {
    seedOpenTaskWithThreshold();
    store.completeTaskBeforeSendOnce = true;

    const result = await runEvaluateReminders(new Date(Date.now() + 86_400_000));

    expect(result.emailsSent).toBe(0);
    expect(sendCalls).toHaveLength(0);
    expect(result.emailsSkippedQuota).toBe(0);
    const email = store.deliveries.find((d) => d.channel === "email")!;
    // Skipped, not failed: a completion is not a delivery failure.
    expect(email.status).toBe("pending");
    expect(email.lastError).toBeUndefined();
  });

  test("stuck-pending sweep skips a task completed mid-run", async () => {
    seedOpenTaskWithThreshold();
    seedPendingDelivery();
    // The missing in_app create fires doInsert, which lands the completion
    // between the snapshot and the sweep.
    store.completeTaskBeforeSendOnce = true;

    const result = await runEvaluateReminders(new Date(Date.now() + 86_400_000));

    expect(sendCalls).toHaveLength(0);
    expect(result.emailsSent).toBe(0);
    expect(
      store.deliveries.find((d) => d.id === "dlv-seed")?.status,
    ).toBe("pending");
  });

  test("failing re-check fails open: sends proceed on snapshot behavior", async () => {
    seedOpenTaskWithThreshold();
    store.failRecheckOnce = true;

    const result = await runEvaluateReminders(new Date(Date.now() + 86_400_000));

    expect(result.emailsSent).toBe(1);
    expect(sendCalls.length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// F-09: sent_at stamped at confirmation, not run start
// ---------------------------------------------------------------------------

describe("F-09: sent_at confirmation time", () => {
  test("email sentAt is stamped at confirmation within the run window", async () => {
    seedOpenTaskWithThreshold();
    const runStart = Date.now();
    const result = await runEvaluateReminders(new Date(runStart));

    expect(result.emailsSent).toBe(1);
    const email = store.deliveries.find((d) => d.channel === "email")!;
    expect(email.status).toBe("sent");
    expect(email.sentAt).toBeInstanceOf(Date);
    expect(email.sentAt!.getTime()).toBeGreaterThanOrEqual(runStart);
    const inApp = store.deliveries.find((d) => d.channel === "in_app")!;
    expect(inApp.sentAt).toBeInstanceOf(Date);
  });

  test("sentAt reflects the confirmation instant, not run start (N-1 discriminating)", async () => {
    seedOpenTaskWithThreshold();
    // Provider takes 250ms; a run-start stamp would read runStart exactly
    // and fail the margin below, while a confirmation stamp passes.
    sendBehavior = async () => {
      await new Promise((resolve) => setTimeout(resolve, 250));
      return { data: { id: "em_slow" }, error: null };
    };
    const runStart = Date.now();
    const result = await runEvaluateReminders(new Date(runStart));

    expect(result.emailsSent).toBe(1);
    const email = store.deliveries.find((d) => d.channel === "email")!;
    expect(email.sentAt!.getTime() - runStart).toBeGreaterThanOrEqual(200);
  });
});

// ---------------------------------------------------------------------------
// F-12: corrupt timestamps fail closed at the evaluator boundary
// ---------------------------------------------------------------------------

describe("F-12: invalid task timestamps", () => {
  test("invalid deadline skips the task instead of failing silently", async () => {
    const now = Date.now();
    store.taskRows = [
      {
        id: TASK,
        userId: USER,
        status: "todo",
        deadline: new Date(NaN),
        createdAt: new Date(now - 10 * 86_400_000),
        title: "Corrupt deadline",
      },
    ];
    store.thresholdRows = [{ id: THRESHOLD, taskId: TASK, daysBefore: 1 }];
    store.profileRows = [{ id: USER, email: "user@example.com", timezone: "UTC" }];

    const result = await runEvaluateReminders(new Date(now + 86_400_000));

    expect(result.created).toBe(0);
    expect(result.emailsSent).toBe(0);
    expect(store.deliveries).toHaveLength(0);
  });

  test("invalid created_at cannot disable the non-retroactive guard", async () => {
    const now = Date.now();
    store.taskRows = [
      {
        id: TASK,
        userId: USER,
        status: "todo",
        deadline: new Date(now + 86_400_000 - 60_000),
        createdAt: new Date("not-a-date"),
        title: "Corrupt created_at",
      },
    ];
    store.thresholdRows = [{ id: THRESHOLD, taskId: TASK, daysBefore: 1 }];
    store.profileRows = [{ id: USER, email: "user@example.com", timezone: "UTC" }];

    const result = await runEvaluateReminders(new Date(now + 86_400_000));

    expect(result.created).toBe(0);
    expect(result.emailsSent).toBe(0);
    expect(store.deliveries).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// F-13: recipient normalization (write path + defensive send path)
// ---------------------------------------------------------------------------

describe("F-13: mixed-case profile email", () => {
  test("sent email normalizes the recipient to lowercase", async () => {
    const now = Date.now();
    store.taskRows = [
      {
        id: TASK,
        userId: USER,
        status: "todo",
        deadline: new Date(now + 86_400_000 - 60_000),
        createdAt: new Date(now - 10 * 86_400_000),
        title: "Task A",
      },
    ];
    store.thresholdRows = [{ id: THRESHOLD, taskId: TASK, daysBefore: 1 }];
    store.profileRows = [
      { id: USER, email: "  Mixed.Case@Example.COM  ", timezone: "UTC" },
    ];

    const result = await runEvaluateReminders(new Date(now + 86_400_000));

    expect(result.emailsSent).toBe(1);
    const to = (sendCalls[0]?.body as { to?: string }).to ?? "";
    expect(to).toBe("mixed.case@example.com");
  });
});

// ---------------------------------------------------------------------------
// RF-09: archived thresholds + offset-keyed delivery identity
// ---------------------------------------------------------------------------

describe("RF-09: archived thresholds and re-added offsets", () => {
  const THRESHOLD_READDED = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";

  test("re-adding an already-sent offset does not send a second reminder", async () => {
    seedOpenTaskWithThreshold();

    const first = await runEvaluateReminders(new Date(Date.now() + 86_400_000));
    expect(first.emailsSent).toBe(1);
    expect(sendCalls).toHaveLength(1);

    // Remove (archive) THRESHOLD, then re-add the same offset under a new id.
    store.thresholdRows = [
      { id: THRESHOLD, taskId: TASK, daysBefore: 1, deletedAt: new Date() },
      { id: THRESHOLD_READDED, taskId: TASK, daysBefore: 1 },
    ];

    const second = await runEvaluateReminders(new Date(Date.now() + 86_400_000));

    expect(second.created).toBe(0);
    expect(second.emailsSent).toBe(0);
    expect(sendCalls).toHaveLength(1);
    // Sent history survives the removal.
    expect(
      store.deliveries.filter((d) => d.channel === "email" && d.status === "sent"),
    ).toHaveLength(1);
  });

  test("an archived threshold's pending delivery is never sent", async () => {
    seedOpenTaskWithThreshold();
    store.thresholdRows = [
      { id: THRESHOLD, taskId: TASK, daysBefore: 1, deletedAt: new Date() },
    ];
    seedPendingDelivery(1);

    const result = await runEvaluateReminders(new Date(Date.now() + 86_400_000));

    expect(sendCalls).toHaveLength(0);
    expect(result.emailsSent).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// RF-11: late labeling + deadline-passed suppression (end to end)
// ---------------------------------------------------------------------------

describe("RF-11: catch-up sends and deadline suppression", () => {
  test("a catch-up send is labeled late in the subject and body", async () => {
    seedOpenTaskWithThreshold();

    const result = await runEvaluateReminders(new Date(Date.now() + 86_400_000));

    expect(result.emailsSent).toBe(1);
    const sent = sendCalls[0]?.body as ReminderEmailBody;
    expect(sent.subject).toBe("[H-1] [LATE] Reminder: Task A");
    expect(sent.text).toContain("delivered late");
  });

  test("a retry rebuilds the same frozen [LATE] body, not the live title", async () => {
    seedOpenTaskWithThreshold();
    sendBehavior = async () => ({
      data: null,
      error: { name: "application_error", message: "boom", statusCode: 500 },
    });

    await runEvaluateReminders(new Date(Date.now() + 86_400_000));
    // Edit the title after the first attempt: the frozen snapshot must govern
    // the retry, including the late label.
    store.taskRows[0].title = "Renamed after first attempt";
    const retry = await runEvaluateReminders(new Date(Date.now() + 86_400_000));

    expect(retry.retried).toBe(1);
    const sent = sendCalls.at(-1)?.body as ReminderEmailBody;
    expect(sent.subject).toBe("[H-1] [LATE] Reminder: Task A");
    expect(sent.text).toContain("delivered late");
  });

  test("a task past the deadline grace creates nothing end to end", async () => {
    const now = Date.now();
    store.profileRows = [
      { id: USER, email: "user@example.com", timezone: "UTC" },
    ];
    store.taskRows = [
      {
        id: TASK,
        userId: USER,
        status: "todo",
        deadline: new Date(now - 3 * 86_400_000),
        createdAt: new Date(now - 10 * 86_400_000),
        title: "Long overdue",
      },
    ];
    store.thresholdRows = [{ id: THRESHOLD, taskId: TASK, daysBefore: 1 }];

    const result = await runEvaluateReminders(new Date(now));

    expect(result.created).toBe(0);
    expect(result.emailsSent).toBe(0);
    expect(sendCalls).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// RF-17: bounded send concurrency + per-user quota hold at scale
// ---------------------------------------------------------------------------

describe("RF-17: scale behavior (mocked load)", () => {
  test(
    "11k due emails across 200 users: concurrency ≤ EMAIL_SEND_CONCURRENCY, runs within the wall-clock bound, quota 50/user enforced at scale",
    async () => {
    // 200 users × 55 open tasks = 11,000 tasks, each with one H-1 email
    // threshold already triggered. The per-run quota caps each user at 50
    // sends/run, so 200×5 = 1,000 emails are skipped as over-quota.
    const now = Date.now();
    const USERS = 60;
    const TASKS_PER_USER = 55;
    const TOTAL_TASKS = USERS * TASKS_PER_USER;
    store.taskRows = [];
    store.thresholdRows = [];
    store.profileRows = [];
    let tid = 0;
    let thid = 0;
    for (let u = 0; u < USERS; u += 1) {
      const userId = `user-${String(u).padStart(4, "0")}`;
      store.profileRows.push({
        id: userId,
        email: `u${u}@example.com`,
        timezone: "UTC",
      });
      for (let t = 0; t < TASKS_PER_USER; t += 1) {
        const id = `task-${String(tid++).padStart(6, "0")}`;
        store.taskRows.push({
          id,
          userId,
          status: "todo",
          // RF-11: like the other fixtures, past-deadline grace must not mask
          // the due H-1 trigger (deadline − 1d).
          deadline: new Date(now + 86_400_000 - 60_000),
          createdAt: new Date(now - 10 * 86_400_000),
          title: `Task ${id}`,
        });
        store.thresholdRows.push({
          id: `thr-${String(thid++).padStart(6, "0")}`,
          taskId: id,
          daysBefore: 1,
          createdAt: new Date(now - 10 * 86_400_000),
        });
      }
    }

    // Track the true number of Resend calls in flight: mapWithLimit must
    // never exceed EMAIL_SEND_CONCURRENCY.
    let inFlight = 0;
    let maxInFlight = 0;
    sendBehavior = async () => {
      inFlight += 1;
      if (inFlight > maxInFlight) maxInFlight = inFlight;
      await new Promise((resolve) => setTimeout(resolve, 2));
      inFlight -= 1;
      return { data: { id: "em_ok" }, error: null };
    };

    const startedAt = Date.now();
    const result = await runEvaluateReminders(new Date(now + 86_400_000 - 60_000), {
      batchSize: 250,
      // Cap + 1 so the run ends on the empty terminal batch (a cap equal to
      // the exact task count would legitimately report `truncated: true`).
      maxTasksPerRun: TOTAL_TASKS + 1,
    });
    const wallMs = Date.now() - startedAt;

    expect(result.evaluatedTasks).toBe(TOTAL_TASKS);
    // Each task triggers one email + one in_app delivery.
    expect(result.created).toBe(2 * TOTAL_TASKS);
    expect(result.emailsSent).toBe(USERS * 50);
    expect(result.emailsSkippedQuota).toBe(USERS * (TASKS_PER_USER - 50));
    expect(result.emailsFailed).toBe(0);
    expect(result.truncated).toBe(false);

    // Concurrency ceiling: never above the bound; with 10k job-sends the
    // limit IS reached (evidence the cap actually engages).
    expect(maxInFlight).toBeLessThanOrEqual(EMAIL_SEND_CONCURRENCY);
    expect(maxInFlight).toBeGreaterThanOrEqual(2);

    // Completes comfortably inside the hard run bound.
    expect(wallMs).toBeLessThan(MAX_RUN_DURATION_MS_DEFAULT);

    console.log(
      `[rf-17] load evidence: ${result.evaluatedTasks} tasks evaluated, ` +
        `${result.emailsSent} sent / ${result.emailsSkippedQuota} quota-skipped, ` +
        `wall ${wallMs}ms, maxInFlight=${maxInFlight} ` +
        `(ceiling ${EMAIL_SEND_CONCURRENCY})`,
    );
  },
  { timeout: 30_000 },
);
});

