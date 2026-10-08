import { and, asc, eq, gt, inArray, isNull, lt, ne, or, sql } from "drizzle-orm";
import {
  evaluateReminders,
  MAX_EMAIL_DELIVERY_RETRIES,
  MAX_EMAILS_PER_USER_PER_RUN,
  type CreateDeliveryAction,
  type ReminderTaskInput,
  type RetryDeliveryAction,
} from "@deadline-radar/domain";
import {
  notificationDeliveries,
  profiles,
  reminderRuns,
  reminderThresholds,
  tasks,
  type EmailDeliverySnapshot,
} from "@deadline-radar/db";

import { getDb } from "../lib/db";
import { mapWithLimit } from "../lib/concurrency";
import {
  buildReminderEmailBody,
  buildReminderIdempotencyKey,
  isConcurrentIdempotentRequest,
  isTerminalIdempotentError,
  resolveEmailIdentity,
  sendReminderEmail,
} from "../lib/email";
import { getReminderCutoff } from "../lib/reminder-cutoff";
import { env } from "../env";

export const EVALUATOR_BATCH_SIZE = 100;

/** RF-12: default per-run cap on evaluated tasks (env MAX_TASKS_PER_RUN). */
export const MAX_TASKS_PER_RUN_DEFAULT = 10_000;

/** RF-12: default wall-clock deadline per run in ms (env MAX_RUN_DURATION_MS).
 * Comfortably under the single-flight lock horizon so a bounded run can never
 * wedge the lock. */
export const MAX_RUN_DURATION_MS_DEFAULT = 120_000;

/** Cap stored run-error text: enough for diagnosis, no PII channel. */
export const MAX_RUN_ERROR_LENGTH = 500;

/** Cap per-run warns for corrupt task timestamps (F-12); overflow is summarized. */
export const MAX_INVALID_TASK_WARNS = 5;

/** Stale-claim horizon for the stuck-sweep atomic claim (F-10): far above
 * worst-case single-send latency (3×10s timeouts + backoff ≈ <2min), so a
 * live claimant is never mistaken for a crashed one. */
export const SENDING_CLAIM_STALE_MS = 15 * 60 * 1000;

/** RF-04: a `running` ledger row older than this is treated as a crashed run
 * and reclaimed (status → error) so the single-flight lock cannot wedge. Must
 * exceed the worst-case full-run duration; runtimes are bounded by the batch
 * loop + statement timeouts. */
export const RUN_LOCK_STALE_MS = 30 * 60 * 1000;

/** NEW-01: bounded retries for the single-flight lock write, then fail-closed.
 * A transient DB error should not cancel an interval; a persistent one must
 * not let a run proceed unlocked. */
export const RUN_LOCK_ACQUIRE_ATTEMPTS = 3;
export const RUN_LOCK_ACQUIRE_BACKOFF_MS = 250;

/** Bound for concurrent Resend sends per batch: well under the postgres.js
 * pool ceiling (max 10) so in-flight sends + claim writes never starve the
 * next batch fetch. Claim predicates are untouched — only throughput changes. */
export const EMAIL_SEND_CONCURRENCY = 5;

/** Cap stored delivery failure text (F-05): provider messages carry no
 * recipient/task PII, cap is defense-in-depth. */
export const MAX_DELIVERY_ERROR_LENGTH = 500;

export type EvaluateRemindersOptions = {
  batchSize?: number;
  /**
   * F-03 first-run burst guard: thresholds that triggered before this
   * instant stay silent. Explicit value (including explicit `null` =
   * force-disable) wins; when absent, falls back to REMINDER_CUTOFF_ISO.
   */
  cutoff?: Date | null;
  /**
   * RF-12: total evaluated-task cap per run. Overrides MAX_TASKS_PER_RUN;
   * when absent the env value applies (default MAX_TASKS_PER_RUN_DEFAULT).
   */
  maxTasksPerRun?: number;
  /**
   * RF-12: wall-clock deadline (ms) per run. Overrides MAX_RUN_DURATION_MS;
   * when absent the env value applies, clamped below the single-flight lock
   * horizon. Deadline is checked between batches (batch-atomic).
   */
  maxRunDurationMs?: number;
};

export type EvaluateRemindersResult = {
  evaluatedTasks: number;
  created: number;
  retried: number;
  emailsSent: number;
  emailsFailed: number;
  /**
   * RF-08: subset of `emailsFailed` from deterministic poison (missing task
   * or recipient email). Excluded from the blackout decision; still persisted
   * in the run ledger's `emails_failed` for observability.
   */
  emailsPoisoned: number;
  /** Due emails skipped by the per-user per-run cap; stay pending. */
  emailsSkippedQuota: number;
  /**
   * I-01: contained row-level DB-operation failures (a single delivery's
   * claim/write throwing). Each is counted and the batch continues; the
   * ledger records an error status so partial runs are never silently "ok".
   * Provider send failures are NOT counted here (they stay in emailsFailed).
   */
  rowErrors: number;
  /** F-04 run-ledger id, or null when the record write itself failed. */
  runId: string | null;
  /**
   * RF-04: true when another run held the single-flight lock, so this
   * invocation did no work. `runId` is null in that case.
   */
  skipped?: boolean;
  /**
   * NEW-01 (fail-closed lock): true when the single-flight lock could not be
   * acquired at all — reclaim + insert failed after bounded retries (a real
   * DB error, not a held lock) — and the run aborted instead of proceeding
   * unlocked. `runId` is null and no work was done; delivery safety holds
   * (no overlap, no quota double-spend), and the DB/infra outage surfaces via
   * `/health/cron` and the out-of-band alert.
   */
  lockUnavailable?: boolean;
  /**
   * RF-12: true when this run stopped at MAX_TASKS_PER_RUN /
   * MAX_RUN_DURATION_MS before scanning all open tasks. The ledger row is
   * finished cleanly (status ok) and the next scheduled run picks up the
   * remainder — already-sent deliveries suppress resends.
   */
  truncated: boolean;
};

/** Postgres unique-violation SQLSTATE. */
function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    (error as { code?: string }).code === "23505"
  );
}

export async function runEvaluateReminders(
  now: Date = new Date(),
  options?: EvaluateRemindersOptions,
): Promise<EvaluateRemindersResult> {
  const db = getDb();
  const batchSize = Math.max(1, options?.batchSize ?? EVALUATOR_BATCH_SIZE);
  // RF-12: per-run bounds. Lenient (RF-13 rules): a bad/unset knob falls back
  // to defaults — a perf knob must never break delivery. Options win over env.
  const maxTasksPerRun =
    options?.maxTasksPerRun ??
    env.maxTasksPerRun() ??
    MAX_TASKS_PER_RUN_DEFAULT;
  const maxRunDurationMs = Math.min(
    options?.maxRunDurationMs ??
      env.maxRunDurationMs() ??
      MAX_RUN_DURATION_MS_DEFAULT,
    // A run that outlives the lock-horizon would wedge the single-flight lock.
    RUN_LOCK_STALE_MS - 60_000,
  );
  const runStartedAt = Date.now();
  // Explicit option (even explicit null) wins over the environment so tests
  // stay deterministic without touching process.env.
  const cutoff =
    options && "cutoff" in options
      ? (options.cutoff ?? null)
      : getReminderCutoff();
  if (cutoff) {
    console.log(`[reminders] cutoff active: ${cutoff.toISOString()}`);
  }

  // F-04 run ledger (observability only — never read for skip/catch-up
  // logic). A failing *observability* write must never break delivery.
  //
  // RF-04: the ledger row doubles as a single-flight lock — a partial unique
  // index allows at most one `running` row. The insert below is the lock
  // acquisition; 23505 means another run is active and this invocation exits
  // before spending any per-user budget.
  //
  // NEW-01 — fail-closed acquisition: a non-23505 write failure (transient
  // DB error) is retried a bounded number of times, and if the lock still
  // cannot be written the run ABORTS (`lockUnavailable: true`) instead of
  // proceeding unlocked. A lock-less run could overlap a live one and
  // double-spend the per-user quota — and would leave no ledger row for
  // /health/cron to see. Delivery safety beats throughput here.
  let runId: string | null = null;
  try {
    for (let attempt = 1; attempt <= RUN_LOCK_ACQUIRE_ATTEMPTS; attempt += 1) {
      try {
        // Reclaim a stale `running` row left by a crashed run so the lock
        // cannot wedge forever. Best-effort: failures are retried below.
        await db
          .update(reminderRuns)
          .set({
            status: "error",
            error: "stale active run reclaimed",
            finishedAt: new Date(),
          })
          .where(
            and(
              eq(reminderRuns.status, "running"),
              lt(reminderRuns.startedAt, new Date(Date.now() - RUN_LOCK_STALE_MS)),
            ),
          );
        const [runRow] = await db
          .insert(reminderRuns)
          .values({})
          .returning({ id: reminderRuns.id });
        runId = runRow?.id ?? null;
        break;
      } catch (error) {
        if (isUniqueViolation(error)) {
          // Another run holds the single-flight lock. Exit without evaluating:
          // the other run owns this interval's sends (and its own budget).
          console.log("[reminders] skipped, another run is active");
          return {
            evaluatedTasks: 0,
            created: 0,
            retried: 0,
            emailsSent: 0,
            emailsFailed: 0,
            emailsPoisoned: 0,
            emailsSkippedQuota: 0,
            rowErrors: 0,
            runId: null,
            skipped: true,
            truncated: false,
          };
        }
        if (attempt >= RUN_LOCK_ACQUIRE_ATTEMPTS) throw error;
        console.log(
          `[reminders] run lock write failed (attempt ${attempt}/${RUN_LOCK_ACQUIRE_ATTEMPTS}), retrying…`,
        );
        await new Promise((resolve) =>
          setTimeout(resolve, RUN_LOCK_ACQUIRE_BACKOFF_MS * attempt),
        );
      }
    }
  } catch (error) {
    // Bounded retries exhausted on a non-23505 failure: the lock could not be
    // acquired. Abort (fail-closed) — proceeding unlocked could overlap a
    // live run and double-spend the per-user budget, and would be invisible
    // to /health/cron.
    console.error(
      "[reminders] run lock unavailable, aborting run",
      error instanceof Error ? error.message : "unknown",
    );
    return {
      evaluatedTasks: 0,
      created: 0,
      retried: 0,
      emailsSent: 0,
      emailsFailed: 0,
      emailsPoisoned: 0,
      emailsSkippedQuota: 0,
      rowErrors: 0,
      runId: null,
      skipped: false,
      truncated: false,
      lockUnavailable: true,
    };
  }

  async function finishRunRecord(
    status: "ok" | "error",
    counts: Omit<EvaluateRemindersResult, "runId">,
    error?: unknown,
  ): Promise<void> {
    if (!runId) return;
    const message =
      error instanceof Error ? error.message : error === undefined ? null : "unknown";
    try {
      await db
        .update(reminderRuns)
        .set({
          finishedAt: new Date(),
          evaluatedTasks: counts.evaluatedTasks,
          created: counts.created,
          retried: counts.retried,
          emailsSent: counts.emailsSent,
          emailsFailed: counts.emailsFailed,
          emailsSkippedQuota: counts.emailsSkippedQuota,
          status,
          truncated: counts.truncated,
          error:
            message === null
              ? null
              : message.slice(0, MAX_RUN_ERROR_LENGTH),
          ...(lastSeenTaskId ? { lastSeenTaskId } : {}),
        })
        .where(eq(reminderRuns.id, runId));
    } catch (writeError) {
      console.error(
        "[reminders] run record finish failed",
        runId,
        writeError instanceof Error ? writeError.message : "unknown",
      );
    }
  }

  /**
   * RF-01 checkpoint: persist the last fully-processed task id after each
   * completed batch. Deliberately written AFTER the batch (inserts, claims,
   * sends, confirm writes all done) so a mid-batch throw leaves the
   * checkpoint at the previous successful batch — the next run re-processes
   * it with the natural `WHERE id > ?` keyset, and provider idempotency
   * dedups anything already sent. Lets an operator resume a crashed run from
   * the ledger row instead of re-evaluating the whole table. Best-effort:
   * failure only logs (observability must never break delivery).
   */
  async function updateRunCheckpoint(
    lastTaskId: string,
    evaluatedTasks: number,
  ): Promise<void> {
    if (!runId) return;
    try {
      await db
        .update(reminderRuns)
        .set({
          lastSeenTaskId: lastTaskId,
          evaluatedTasks,
        })
        .where(eq(reminderRuns.id, runId));
    } catch (error) {
      console.error(
        "[reminders] run checkpoint update failed",
        runId,
        error instanceof Error ? error.message : "unknown",
      );
    }
  }

  let totalEvaluated = 0;
  let totalCreated = 0;
  let totalRetried = 0;
  let totalEmailsSent = 0;
  let totalEmailsFailed = 0;
  let totalEmailsSkippedQuota = 0;
  // RF-08: subset of totalEmailsFailed caused by deterministic poison
  // (missing task / recipient). Counted in emails_failed for the ledger, but
  // excluded from the systemic-blackout decision so a single orphaned
  // delivery can never raise a false "all sends failed" alert.
  let totalEmailsPoisoned = 0;
  const emailsSentByUser = new Map<string, number>();
  let invalidTaskWarned = 0;
  let invalidTaskSuppressed = 0;

  /**
   * SEC-003: per-user per-run send budget. Returns false when the user has
   * exhausted this run's budget — the caller must skip the send and leave
   * the delivery `pending` for a later run (never mark it failed).
   */
  function claimUserSendBudget(userId: string): boolean {
    const used = emailsSentByUser.get(userId) ?? 0;
    if (used >= MAX_EMAILS_PER_USER_PER_RUN) return false;
    emailsSentByUser.set(userId, used + 1);
    return true;
  }

  // State-confirmation writes must never fail the whole cron run: a single
  // delivery's failing UPDATE is recorded and the run continues. Delivery
  // semantics stay at-least-once; provider idempotency (same key per
  // delivery + payload) prevents duplicate sends within its window.
  async function markFailed(
    deliveryId: string,
    retryCount?: number,
    error?: unknown,
    snapshot?: EmailDeliverySnapshot,
    idempotencyKey?: string,
  ): Promise<boolean> {
    // F-05 failure context (observability only): last_error + failed_at
    // always describe the same most recent attempt. Truncated: provider
    // messages carry no recipient/task PII (those are built into the
    // subject/body separately), cap is defense-in-depth.
    const message =
      error instanceof Error && error.message.length > 0
        ? error.message
        : typeof error === "string" && error.length > 0
          ? error
          : null;
    try {
      await db
        .update(notificationDeliveries)
        .set({
          status: "failed",
          ...(retryCount != null ? { retryCount } : {}),
          failedAt: new Date(),
          ...(message !== null
            ? { lastError: message.slice(0, MAX_DELIVERY_ERROR_LENGTH) }
            : {}),
          // RF-02: freeze the body/key with the failure so the next run
          // rebuilds the identical email (and key) for the retry.
          ...(snapshot ? { emailSnapshot: snapshot } : {}),
          ...(idempotencyKey ? { emailIdempotencyKey: idempotencyKey } : {}),
        })
        .where(eq(notificationDeliveries.id, deliveryId));
      return true;
    } catch (writeError) {
      console.error(
        "[reminders] markFailed failed",
        deliveryId,
        writeError instanceof Error ? writeError.message : "unknown",
      );
      return false;
    }
  }

  async function markSent(
    deliveryId: string,
    snapshot?: EmailDeliverySnapshot,
    idempotencyKey?: string,
  ): Promise<boolean> {
    try {
      // F-09: stamp the provider-confirmation instant, not the run start —
      // long runs would otherwise backdate sent_at by minutes.
      await db
        .update(notificationDeliveries)
        .set({
          status: "sent",
          sentAt: new Date(),
          // RF-02: freeze the body/key on the first successful send too, so
          // the delivery's email identity is recorded either way.
          ...(snapshot ? { emailSnapshot: snapshot } : {}),
          ...(idempotencyKey ? { emailIdempotencyKey: idempotencyKey } : {}),
        })
        .where(eq(notificationDeliveries.id, deliveryId));
      return true;
    } catch (error) {
      const message =
        error instanceof Error && error.message.length > 0
          ? error.message
          : "unknown";
      console.error("[reminders] markSent failed", deliveryId, message);
      try {
        // RF-01: the provider already accepted this email; the confirm
        // write failed. Never mark the row `failed` — that would lie about
        // delivery. Leave status untouched (still `pending`/`sending`, so a
        // later run re-sends under the same idempotency key, which the
        // provider dedups) and record the confirmation failure so
        // `emailsFailed` is never a silent counter. Best-effort write: if
        // this also fails, the DB is down and nothing more can be persisted.
        await db
          .update(notificationDeliveries)
          .set({
            lastError: `confirm failed: ${message}`.slice(
              0,
              MAX_DELIVERY_ERROR_LENGTH,
            ),
            failedAt: new Date(),
            // RF-02: freeze the body/key here too. The email was accepted
            // upstream; if the task is edited before the stale claim is
            // reclaimed, the re-send must reuse this exact identity.
            ...(snapshot ? { emailSnapshot: snapshot } : {}),
            ...(idempotencyKey ? { emailIdempotencyKey: idempotencyKey } : {}),
          })
          .where(eq(notificationDeliveries.id, deliveryId));
      } catch (contextError) {
        console.error(
          "[reminders] markSent context write failed",
          deliveryId,
          contextError instanceof Error ? contextError.message : "unknown",
        );
      }
      return false;
    }
  }

  /**
   * RF-02 (#143): persist the delivery's email identity BEFORE the provider
   * call.
   *
   * The identity used to be written only by `markSent`/`markFailed`, i.e. after
   * the attempt. A crash in that window left the row unidentified, so the
   * recovery sweep rebuilt the body from the *live* task — and a title edit in
   * between produced a different body hash, hence a different provider key,
   * hence a duplicate email for the user.
   *
   * Fail closed: if this write fails we do NOT send. Sending with an unfrozen
   * identity is exactly the duplicate-producing case above, and the row stays
   * `pending`/`sending` for the next run (same disposition as a failed
   * sweep-claim write).
   */
  async function freezeEmailIdentity(
    deliveryId: string,
    snapshot: EmailDeliverySnapshot,
    idempotencyKey: string,
  ): Promise<boolean> {
    try {
      await db
        .update(notificationDeliveries)
        .set({ emailSnapshot: snapshot, emailIdempotencyKey: idempotencyKey })
        .where(eq(notificationDeliveries.id, deliveryId));
      return true;
    } catch (error) {
      console.error(
        "[reminders] email identity freeze failed",
        deliveryId,
        error instanceof Error ? error.message : "unknown",
      );
      return false;
    }
  }

  /**
   * Send one delivery email. Only reached with a delivery this run owns
   * (fresh insert win or atomic retry claim); provider idempotency makes a
   * concurrent same-key send collapse to a single email.
   */
  async function deliverEmail(input: {
    deliveryId: string;
    to: string;
    taskTitle: string;
    daysBefore: number;
    deadlineIso: string;
    /** Recipient profile timezone for deadline rendering (F-07). */
    timeZone: string;
    /** RF-02: frozen body inputs from the delivery row, when already set. */
    emailSnapshot?: EmailDeliverySnapshot | null;
    /** RF-02: exact provider key to reuse, when already set (incl. rotated). */
    emailIdempotencyKey?: string | null;
    /** RF-11: scheduler catch-up label for a first-attempt create. Retries
     * rebuild from the frozen snapshot instead. */
    late?: boolean;
  }): Promise<void> {
    // F-13: normalize the recipient defensively (write path normalizes in
    // the profile triggers; this covers pre-existing mixed-case rows and
    // any future writer). Normalized before body build so the idempotency
    // key stays consistent with what is sent.
    const identity = resolveEmailIdentity({
      deliveryId: input.deliveryId,
      to: input.to,
      live: {
        taskTitle: input.taskTitle,
        deadlineIso: input.deadlineIso,
        timeZone: input.timeZone,
        daysBefore: input.daysBefore,
        late: input.late,
      },
      emailSnapshot: input.emailSnapshot,
      emailIdempotencyKey: input.emailIdempotencyKey,
    });
    const { payload, snapshot, idempotencyKey } = identity;

    if (
      identity.needsFreeze &&
      !(await freezeEmailIdentity(
        input.deliveryId,
        snapshot,
        idempotencyKey,
      ))
    ) {
      totalEmailsFailed += 1;
      return;
    }

    try {
      // #144: `runId` is correlation-only — it rides along so each provider
      // attempt's telemetry line can be tied to this run without a DB join.
      await sendReminderEmail(payload, { idempotencyKey, runId });
    } catch (error) {
      if (isConcurrentIdempotentRequest(error)) {
        // 409 concurrent_idempotent_requests means another run is delivering
        // this email under the same key. Leave it pending for a later run.
        return;
      }
      if (isTerminalIdempotentError(error)) {
        // RF-02: the provider permanently rejected this key (e.g. a stale key
        // shape or collision). Reusing it would fail forever, so rotate to a
        // fresh key over the same frozen body and persist it; the next run
        // then sends under the rotated key.
        const rotated = buildReminderIdempotencyKey({
          deliveryId: input.deliveryId,
          body: buildReminderEmailBody(payload),
          nonce: Date.now().toString(36),
        });
        console.warn(
          "[reminders] terminal idempotency error, rotating key",
          input.deliveryId,
          error instanceof Error ? error.message : "unknown",
        );
        await markFailed(input.deliveryId, undefined, error, snapshot, rotated);
        totalEmailsFailed += 1;
        return;
      }
      // retryCount is deliberately not written here: the retry claim owns that
      // increment (#143), so a failure never consumes budget on its own.
      await markFailed(
        input.deliveryId,
        undefined,
        error,
        snapshot,
        idempotencyKey,
      );
      totalEmailsFailed += 1;
      return;
    }
    const confirmed = await markSent(
      input.deliveryId,
      snapshot,
      idempotencyKey,
    );
    if (confirmed) {
      totalEmailsSent += 1;
    } else {
      totalEmailsFailed += 1;
    }
  }

  let lastSeenTaskId: string | null = null;

  // RF-12: set when a run stops at MAX_TASKS_PER_RUN / MAX_RUN_DURATION_MS.
  let truncated = false;

  // A mid-run throw still finalizes the ledger row (status error) before
  // propagating, so crashes are distinguishable from a dead scheduler.
  // Only batch/infra-scope failures reach that path: per-delivery
  // (row-level) DB failures are contained below via recordRowError and never
  // throw, so one bad row cannot abort the rest of the batch (I-01).
  let runError: unknown = null;

  // I-01 row/batch/infra taxonomy state. Row-level = one delivery's
  // claim/write/cancel; contained (count-and-continue). Batch/infra =
  // batch selects, multi-row inserts, lock/pool; fail-fast with ledger
  // error (runError path above).
  let rowErrors = 0;
  let firstRowError: string | null = null;
  function recordRowError(error: unknown, context: string): void {
    rowErrors += 1;
    const message =
      error instanceof Error && error.message.length > 0
        ? error.message
        : "unknown";
    if (firstRowError === null) firstRowError = message;
    console.error(
      `[reminders] row-level DB failure contained (${context})`,
      message,
    );
  }
  try {
    while (true) {
      // RF-12: stop at the per-run bounds. Checked BEFORE the batch select,
      // so batches stay atomic (a started batch always completes and is
      // checkpointed — same semantics as the RF-01 checkpoint). The first
      // batch always runs (lastSeenTaskId === null), even for a zero cap.
      if (
        lastSeenTaskId !== null &&
        (totalEvaluated >= maxTasksPerRun ||
          Date.now() - runStartedAt >= maxRunDurationMs)
      ) {
        truncated = true;
        break;
      }
      const taskRows = await db
        .select({
          id: tasks.id,
          userId: tasks.userId,
          status: tasks.status,
          deadline: tasks.deadline,
          createdAt: tasks.createdAt,
          deadlineUpdatedAt: tasks.deadlineUpdatedAt,
          title: tasks.title,
        })
        .from(tasks)
        .where(
          and(
            ne(tasks.status, "done"),
            isNull(tasks.deletedAt),
            lastSeenTaskId ? gt(tasks.id, lastSeenTaskId) : undefined,
          ),
        )
        .orderBy(asc(tasks.id))
        .limit(batchSize);

      if (taskRows.length === 0) {
        break;
      }

      lastSeenTaskId = taskRows[taskRows.length - 1].id;
      totalEvaluated += taskRows.length;

      const taskIds = taskRows.map((t) => t.id);
      const userIds = [...new Set(taskRows.map((t) => t.userId))];

      // The three lookups filter on the already-known keysets above and share
      // no data dependencies — fan them out over the pool instead of paying
      // 3 serial RTTs per batch.
      const [thresholdRows, deliveryRows, profileRows] = await Promise.all([
        db
          .select()
          .from(reminderThresholds)
          .where(
            and(
              inArray(reminderThresholds.taskId, taskIds),
              isNull(reminderThresholds.deletedAt),
            ),
          ),
        db
          .select()
          .from(notificationDeliveries)
          .where(inArray(notificationDeliveries.taskId, taskIds)),
        db
          .select({
            id: profiles.id,
            email: profiles.email,
            timezone: profiles.timezone,
          })
          .from(profiles)
          .where(inArray(profiles.id, userIds)),
      ]);

      // O(1) Maps scoped strictly to this batch
      // F-12: corrupt timestamps fail closed (never send) instead of
      // silently degrading guards — an invalid created_at would otherwise
      // disable the non-retroactive guard entirely (NaN comparisons are
      // always false). DB columns are timestamptz NOT NULL so this is
      // unreachable in production; it hardens the boundary for any non-DB
      // caller. task_id only in the log — no PII.
      const activeTaskRows = taskRows.filter((task) => {
        const valid =
          task.deadline instanceof Date &&
          !Number.isNaN(task.deadline.getTime()) &&
          task.createdAt instanceof Date &&
          !Number.isNaN(task.createdAt.getTime());
        if (!valid) {
          if (invalidTaskWarned < MAX_INVALID_TASK_WARNS) {
            console.warn(
              "[reminders] skipping task with invalid timestamp",
              task.id,
            );
            invalidTaskWarned += 1;
          } else {
            invalidTaskSuppressed += 1;
          }
        }
        return valid;
      });
      const taskById = new Map(activeTaskRows.map((t) => [t.id, t]));
      const profileById = new Map(profileRows.map((p) => [p.id, p]));

      const thresholdsByTask = new Map<string, typeof thresholdRows>();
      for (const row of thresholdRows) {
        const list = thresholdsByTask.get(row.taskId) ?? [];
        list.push(row);
        thresholdsByTask.set(row.taskId, list);
      }

      const deliveriesByTask = new Map<string, typeof deliveryRows>();
      for (const row of deliveryRows) {
        const list = deliveriesByTask.get(row.taskId) ?? [];
        list.push(row);
        deliveriesByTask.set(row.taskId, list);
      }
      // RF-02: retries rebuild the email from the row's frozen snapshot/key
      // (present for any delivery that already attempted a send).
      const deliveryById = new Map(deliveryRows.map((d) => [d.id, d]));

      const inputs: ReminderTaskInput[] = activeTaskRows.map((task) => {
        const profile = profileById.get(task.userId);
        return {
          id: task.id,
          status: task.status,
          deadline: task.deadline.toISOString(),
          created_at: task.createdAt.toISOString(),
          // F-01: null/legacy rows fall back to created_at inside the evaluator.
          deadline_updated_at:
            task.deadlineUpdatedAt?.toISOString() ??
            task.createdAt.toISOString(),
          timeZone: profile?.timezone ?? "UTC",
          thresholds: (thresholdsByTask.get(task.id) ?? []).map((t) => ({
            id: t.id,
            days_before: t.daysBefore,
            // Test doubles and legacy rows may lack these columns; fall back
            // to the task creation time (== old creation-only guard).
            updated_at:
              t.updatedAt?.toISOString() ??
              t.createdAt?.toISOString() ??
              task.createdAt.toISOString(),
            created_at:
              t.createdAt?.toISOString() ?? task.createdAt.toISOString(),
          })),
          deliveries: (deliveriesByTask.get(task.id) ?? []).map((d) => ({
            id: d.id,
            threshold_id: d.thresholdId,
            days_before: d.daysBefore,
            channel: d.channel,
            status: d.status,
            retry_count: d.retryCount,
          })),
        };
      });

      const inputByTaskId = new Map(inputs.map((input) => [input.id, input]));

      const actions = evaluateReminders(inputs, now, { cutoff });

      const emailWork: {
        deliveryId: string;
        taskId: string;
        thresholdId: string;
        daysBefore: number;
        late?: boolean;
      }[] = [];

      const inAppCreates = actions.filter(
        (a): a is CreateDeliveryAction =>
          a.action === "create" && a.channel === "in_app",
      );
      const emailCreates = actions.filter(
        (a): a is CreateDeliveryAction =>
          a.action === "create" && a.channel === "email",
      );
      const retryActions = actions.filter(
        (a): a is RetryDeliveryAction => a.action === "retry",
      );

      // Concurrent runs may decide the same creates; the unique
      // (thresholdId, daysBefore, channel) index arbitrates. Losers are
      // no-ops. One multi-row INSERT per channel; RETURNING carries the
      // unique key so each returned row maps back to its action.
      if (inAppCreates.length > 0) {
        const insertedInApp = await db
          .insert(notificationDeliveries)
          .values(
            inAppCreates.map((action) => ({
              taskId: action.task_id,
              thresholdId: action.threshold_id,
              daysBefore: action.days_before,
              channel: "in_app" as const,
              status: "sent" as const,
              // F-09: insert time IS this channel's confirmation time.
              sentAt: new Date(),
            })),
          )
          .onConflictDoNothing({
            target: [
              notificationDeliveries.thresholdId,
              notificationDeliveries.daysBefore,
              notificationDeliveries.channel,
            ],
          })
          .returning({ id: notificationDeliveries.id });
        totalCreated += insertedInApp.length;
      }

      if (emailCreates.length > 0) {
        const insertedEmail = await db
          .insert(notificationDeliveries)
          .values(
            emailCreates.map((action) => ({
              taskId: action.task_id,
              thresholdId: action.threshold_id,
              daysBefore: action.days_before,
              channel: "email" as const,
              status: "pending" as const,
            })),
          )
          .onConflictDoNothing({
            target: [
              notificationDeliveries.thresholdId,
              notificationDeliveries.daysBefore,
              notificationDeliveries.channel,
            ],
          })
          .returning({
            id: notificationDeliveries.id,
            thresholdId: notificationDeliveries.thresholdId,
            daysBefore: notificationDeliveries.daysBefore,
            channel: notificationDeliveries.channel,
          });
        // Lost the conflict race: the winner owns this delivery, so there is
        // nothing to queue and nothing to count. Never throws 23505.
        totalCreated += insertedEmail.length;
        const createdByKey = new Map(
          insertedEmail.map((row) => [
            `${row.thresholdId}:${row.daysBefore}:${row.channel}`,
            row.id,
          ]),
        );
        for (const action of emailCreates) {
          const id = createdByKey.get(
            `${action.threshold_id}:${action.days_before}:${action.channel}`,
          );
          if (!id) continue;
          emailWork.push({
            deliveryId: id,
            taskId: action.task_id,
            thresholdId: action.threshold_id,
            daysBefore: action.days_before,
            late: action.late,
          });
        }
      }

      // I-06: one set-based atomic claim for the whole batch (1 statement,
      // N rows) instead of N per-row UPDATEs. The per-row predicate is
      // preserved inside WHERE — only rows still `failed` below the retry cap
      // transition, so a concurrent run acting on a stale snapshot gets 0 of
      // those rows and exactly one run delivers each retry. RETURNING ids map
      // back to actions in input order so emailWork stays deterministic.
      // A statement failure is batch-scope (not row-scope): it propagates to
      // the runError abort path with a ledger error.
      if (retryActions.length > 0) {
        const claimed = await db
          .update(notificationDeliveries)
          .set({
            status: "pending",
            retryCount: sql`${notificationDeliveries.retryCount} + 1`,
          })
          .where(
            and(
              inArray(
                notificationDeliveries.id,
                retryActions.map((action) => action.delivery_id),
              ),
              eq(notificationDeliveries.status, "failed"),
              lt(notificationDeliveries.retryCount, MAX_EMAIL_DELIVERY_RETRIES),
            ),
          )
          .returning({ id: notificationDeliveries.id });
        const claimedIds = new Set(claimed.map((row) => row.id));
        for (const action of retryActions) {
          if (!claimedIds.has(action.delivery_id)) continue;
          totalRetried += 1;
          emailWork.push({
            deliveryId: action.delivery_id,
            taskId: action.task_id,
            thresholdId: action.threshold_id,
            daysBefore: action.days_before,
          });
        }
      }

      // F-08: a task may be completed (or deleted) after the batch snapshot
      // but before these serial sends execute. Re-check live status in one
      // indexed query and skip anything no longer active. Done rows ARE
      // returned (their status is the signal); soft-deleted rows are not
      // (absent from the map = skip, covering both cases). A failing
      // re-check fails open with a warning — a guard must never strand
      // reminders on transient DB trouble.
      //
      // RF-07: the same re-check also captures the live version of the two
      // inputs that decide this send — the task's deadline version and each
      // threshold's version. If either moved between the batch snapshot and
      // now, the queued email was built for a deadline/offset that no longer
      // exists, so it is cancelled (row deleted, no quota consumed) instead
      // of sending stale content. Unrelated edits (title/status/course) do
      // not touch these columns and are covered by the RF-02 frozen body.
      type LiveTaskRow = {
        id: string;
        status: string;
        deadlineUpdatedAt: Date | null;
        createdAt: Date;
      };
      type LiveThresholdRow = {
        id: string;
        taskId: string;
        updatedAt: Date | null;
        createdAt: Date;
      };
      let liveTaskById: Map<string, LiveTaskRow> | null = null;
      let liveThresholdById: Map<string, LiveThresholdRow> | null = null;
      try {
        const [liveTaskRows, liveThresholdRows] = await Promise.all([
          db
            .select({
              id: tasks.id,
              status: tasks.status,
              deadlineUpdatedAt: tasks.deadlineUpdatedAt,
              createdAt: tasks.createdAt,
            })
            .from(tasks)
            .where(and(inArray(tasks.id, taskIds), isNull(tasks.deletedAt))),
          db
            .select({
              id: reminderThresholds.id,
              taskId: reminderThresholds.taskId,
              updatedAt: reminderThresholds.updatedAt,
              createdAt: reminderThresholds.createdAt,
            })
            .from(reminderThresholds)
            .where(
              and(
                inArray(reminderThresholds.taskId, taskIds),
                isNull(reminderThresholds.deletedAt),
              ),
            ),
        ]);
        liveTaskById = new Map(liveTaskRows.map((t) => [t.id, t]));
        liveThresholdById = new Map(liveThresholdRows.map((t) => [t.id, t]));
      } catch (error) {
        console.error(
          "[reminders] live status re-check failed, proceeding with snapshot",
          error instanceof Error ? error.message : "unknown",
        );
      }

      /** True while the task is still sendable (active at send time). */
      function isTaskLive(taskId: string): boolean {
        // No live map (re-check failed) → fail open with snapshot behavior.
        if (!liveTaskById) return true;
        const row = liveTaskById.get(taskId);
        return row !== undefined && row.status !== "done";
      }

      /** Version of a row's edit marker, or null when the fake/legacy row
       * carries neither column (then the check fails open). */
      function versionOf(row: {
        updatedAt?: Date | null;
        createdAt?: Date | null;
      }): number | null {
        const stamp = row.updatedAt ?? row.createdAt ?? null;
        return stamp instanceof Date ? stamp.getTime() : null;
      }

      /**
       * RF-07: true when the queued delivery was built from a deadline or
       * threshold version that changed mid-run. Fails open whenever the live
       * maps are unavailable or a version is unreadable, so a transient DB
       * problem can never strand reminders.
       */
      function isDeliveryStale(work: {
        taskId: string;
        thresholdId: string;
      }): boolean {
        if (!liveTaskById || !liveThresholdById) return false;
        const snapshotTask = taskById.get(work.taskId);
        const liveTask = liveTaskById.get(work.taskId);
        if (!snapshotTask || !liveTask) return true;
        const snapshotDeadline = versionOf({
          updatedAt: snapshotTask.deadlineUpdatedAt,
          createdAt: snapshotTask.createdAt,
        });
        const liveDeadline = versionOf({
          updatedAt: liveTask.deadlineUpdatedAt,
          createdAt: liveTask.createdAt,
        });
        if (
          snapshotDeadline !== null &&
          liveDeadline !== null &&
          snapshotDeadline !== liveDeadline
        ) {
          return true;
        }
        const snapshotThreshold = (thresholdsByTask.get(work.taskId) ?? []).find(
          (t) => t.id === work.thresholdId,
        );
        const liveThreshold = liveThresholdById.get(work.thresholdId);
        if (!snapshotThreshold || !liveThreshold) return true;
        const snapshotThresholdVersion = versionOf(snapshotThreshold);
        const liveThresholdVersion = versionOf(liveThreshold);
        return (
          snapshotThresholdVersion !== null &&
          liveThresholdVersion !== null &&
          snapshotThresholdVersion !== liveThresholdVersion
        );
      }

      /** Drop cancelled deliveries so a later run can re-create them cleanly
       * (lingering `pending` rows would suppress re-evaluation instead).
       * I-06: one batched DELETE for the whole batch instead of serial
       * per-row awaits. Never throws (I-01 row-level): a failing delete
       * leaves the rows pending for the next run and the batch continues. */
      async function cancelStaleDeliveries(deliveryIds: string[]): Promise<void> {
        if (deliveryIds.length === 0) return;
        try {
          await db
            .delete(notificationDeliveries)
            .where(inArray(notificationDeliveries.id, deliveryIds));
          console.log(
            `[reminders] cancelled ${deliveryIds.length} deliveries (stale mid-run or outside scheduling window)`,
          );
        } catch (error) {
          recordRowError(error, "cancel-stale-batch");
        }
      }

      const staleDeliveryIds: string[] = [];

      // Send jobs run with bounded concurrency below. Everything order- or
      // budget-sensitive (live check, recipient lookup, per-user quota claim)
      // stays serial here; only the Resend network calls fan out. Counters
      // are updated in these serial pre-passes or inside deliverEmail's own
      // contained writes — never racily from concurrent jobs.
      const sendJobs: (() => Promise<void>)[] = [];

      for (const work of emailWork) {
        if (!isTaskLive(work.taskId)) {
          // Completed/deleted mid-run: skip quietly (no failure recorded,
          // no quota consumed). The delivery stays pending, orphaned exactly
          // like any post-insert completion today.
          console.log(
            "[reminders] skipped send, task no longer active",
            work.deliveryId,
          );
          continue;
        }
        if (isDeliveryStale(work)) {
          // Deadline/threshold edited mid-run: the queued email is stale.
          // Collected for the single batched delete below.
          staleDeliveryIds.push(work.deliveryId);
          continue;
        }
        const task = taskById.get(work.taskId);
        const profile = task ? profileById.get(task.userId) : undefined;
        const to = profile?.email ?? null;
        if (!task || !to) {
          // RF-08: deterministic poison — jump straight to the retry cap so the
          // evaluator never re-offers it, and count it separately so it cannot
          // trigger a false blackout.
          await markFailed(
            work.deliveryId,
            MAX_EMAIL_DELIVERY_RETRIES,
            "missing task or recipient email",
          );
          totalEmailsFailed += 1;
          totalEmailsPoisoned += 1;
          continue;
        }
        if (!claimUserSendBudget(task.userId)) {
          totalEmailsSkippedQuota += 1;
          continue;
        }
        sendJobs.push(async () => {
          try {
            await deliverEmail({
              deliveryId: work.deliveryId,
              to,
              taskTitle: task.title,
              daysBefore: work.daysBefore,
              deadlineIso: task.deadline.toISOString(),
              timeZone: profile?.timezone ?? "UTC",
              emailSnapshot: deliveryById.get(work.deliveryId)?.emailSnapshot,
              emailIdempotencyKey:
                deliveryById.get(work.deliveryId)?.emailIdempotencyKey,
              late: work.late,
            });
          } catch (error) {
            // I-01 row-level: deliverEmail contains its own send/write
            // failures, so reaching here is unexpected — contain it anyway
            // so one delivery can never abort the batch via mapWithLimit's
            // Promise.all.
            recordRowError(error, "send");
            totalEmailsFailed += 1;
          }
        });
      }

      const queuedIds = new Set(emailWork.map((w) => w.deliveryId));
      // F-10: the sweep covers pending rows plus possibly-orphaned sending
      // rows; the atomic claim below arbitrates (fresh leases belong to a
      // live run and lose, stale ones are reclaimed).
      const stuckPendingInBatch = deliveryRows.filter(
        (d) =>
          d.channel === "email" &&
          (d.status === "pending" || d.status === "sending") &&
          !queuedIds.has(d.id),
      );

      let sweptOutsideWindow = 0;
      for (const row of stuckPendingInBatch) {
        const task = taskById.get(row.taskId);
        if (!task || !isTaskLive(row.taskId)) continue;
        if (
          isDeliveryStale({ taskId: row.taskId, thresholdId: row.thresholdId })
        ) {
          staleDeliveryIds.push(row.id);
          continue;
        }
        // RF-11/F-03 parity: the sweep must not send a row the normal
        // evaluator would no longer schedule (deadline grace, cutoff,
        // non-retroactive/F-01, not due). Re-run the domain decision with the
        // target row and orphan/already-cancelled siblings removed so their
        // `pending` status cannot mask the verdict; a matching create means
        // the row is still schedulable now.
        const input = inputByTaskId.get(row.taskId);
        let dueAction: CreateDeliveryAction | undefined;
        if (input) {
          const liveThresholdIds = new Set(input.thresholds.map((t) => t.id));
          dueAction = evaluateReminders(
            [
              {
                ...input,
                deliveries: input.deliveries.filter(
                  (delivery) =>
                    delivery.id !== row.id &&
                    liveThresholdIds.has(delivery.threshold_id) &&
                    !staleDeliveryIds.includes(delivery.id),
                ),
              },
            ],
            now,
            { cutoff },
          ).find(
            (action): action is CreateDeliveryAction =>
              action.action === "create" &&
              action.channel === "email" &&
              action.threshold_id === row.thresholdId &&
              action.days_before === row.daysBefore,
          );
        }
        if (!dueAction) {
          // Cancel the row instead of sending a stale catch-up: same terminal
          // disposition a fresh evaluation assigns (no delivery), and no
          // quota is consumed.
          staleDeliveryIds.push(row.id);
          sweptOutsideWindow += 1;
          continue;
        }
        const profile = profileById.get(task.userId);
        const to = profile?.email;
        if (!to) {
          // RF-08: same terminal treatment as the fresh-create path above.
          await markFailed(
            row.id,
            MAX_EMAIL_DELIVERY_RETRIES,
            "missing task or recipient email",
          );
          totalEmailsFailed += 1;
          totalEmailsPoisoned += 1;
          continue;
        }
        if (!claimUserSendBudget(task.userId)) {
          totalEmailsSkippedQuota += 1;
          continue;
        }
        // F-10 atomic sweep claim: exactly one overlapping run may deliver
        // this stuck row. A `sending` row with a stale lease is a crashed
        // claimant and is reclaimable; a fresh one belongs to a live run.
        // No row lock is held across the network call that follows. The claim
        // stays inside the job so it immediately precedes its send.
        sendJobs.push(async () => {
          try {
            const [claimedSweep] = await db
              .update(notificationDeliveries)
              .set({ status: "sending", claimedAt: new Date() })
              .where(
                and(
                  eq(notificationDeliveries.id, row.id),
                  or(
                    eq(notificationDeliveries.status, "pending"),
                    and(
                      eq(notificationDeliveries.status, "sending"),
                      lt(
                        notificationDeliveries.claimedAt,
                        new Date(Date.now() - SENDING_CLAIM_STALE_MS),
                      ),
                    ),
                  ),
                ),
              )
              .returning({ id: notificationDeliveries.id });
            if (!claimedSweep) return;
            // No row lock is held across this network call: same-key concurrent
            // sends dedup at the provider, and confirmation writes are contained.
            await deliverEmail({
              deliveryId: row.id,
              to,
              taskTitle: task.title,
              daysBefore: row.daysBefore,
              deadlineIso: task.deadline.toISOString(),
              timeZone: profile?.timezone ?? "UTC",
              emailSnapshot: row.emailSnapshot,
              emailIdempotencyKey: row.emailIdempotencyKey,
              late: dueAction.late,
            });
          } catch (error) {
            // I-01 row-level: a sweep-claim DB throw (or any unexpected send
            // failure) is contained — the row stays pending/sending for the
            // next run and the rest of the batch completes. F-10 exactly-once
            // semantics are untouched: the claim still immediately precedes
            // its send inside the job.
            recordRowError(error, "sweep-claim");
            totalEmailsFailed += 1;
          }
        });
      }

      if (sweptOutsideWindow > 0) {
        console.log(
          `[reminders] sweep cancelled ${sweptOutsideWindow} deliveries outside the scheduling window`,
        );
      }

      // I-06: one batched drop for every delivery cancelled as stale above.
      await cancelStaleDeliveries(staleDeliveryIds);

      await mapWithLimit(sendJobs, EMAIL_SEND_CONCURRENCY, (job) => job());

      // RF-01: persist the checkpoint only after this batch fully completed
      // (see updateRunCheckpoint for the crash-safety reasoning).
      await updateRunCheckpoint(lastSeenTaskId, totalEvaluated);

      if (taskRows.length < batchSize) {
        break;
      }
    }
  } catch (error) {
    runError = error;
  }

  if (truncated) {
    // RF-12 observability: how deep is the backlog the next run must mop up?
    // One indexed COUNT over open tasks behind the cursor, only on truncation.
    try {
      const [{ remaining }] = await db
        .select({
          remaining: sql<number>`count(*)::int`,
        })
        .from(tasks)
        .where(
          and(
            ne(tasks.status, "done"),
            isNull(tasks.deletedAt),
            lastSeenTaskId ? gt(tasks.id, lastSeenTaskId) : undefined,
          ),
        );
      console.log(
        `[reminders] run truncated at ${totalEvaluated} tasks (cap ${maxTasksPerRun}, deadline ${maxRunDurationMs}ms); ${remaining} open tasks remain behind the cursor — next run picks them up`,
      );
    } catch (error) {
      console.error(
        "[reminders] truncation backlog count failed",
        error instanceof Error ? error.message : "unknown",
      );
    }
  }

  // I-01: contained row errors still finalize the ledger as error (never
  // silently "ok") but do NOT throw — the batch completed and the HTTP
  // contract stays 200. Only batch/infra failures (runError) rethrow.
  const rowErrorSummary =
    rowErrors > 0
      ? `${rowErrors} row-level DB failure${rowErrors === 1 ? "" : "s"} contained (first: ${firstRowError ?? "unknown"}) — rest of batch completed`
      : null;
  const result: EvaluateRemindersResult = {
    evaluatedTasks: totalEvaluated,
    created: totalCreated,
    retried: totalRetried,
    emailsSent: totalEmailsSent,
    emailsFailed: totalEmailsFailed,
    emailsPoisoned: totalEmailsPoisoned,
    emailsSkippedQuota: totalEmailsSkippedQuota,
    rowErrors,
    runId,
    truncated,
  };
  if (invalidTaskSuppressed > 0) {
    console.warn(
      `[reminders] skipped ${invalidTaskSuppressed} more tasks with invalid timestamps`,
    );
  }
  await finishRunRecord(
    runError || rowErrorSummary ? "error" : "ok",
    result,
    // finishRunRecord extracts Error.message: wrap the summary so the ledger
    // carries the row-error context instead of "unknown".
    runError ?? (rowErrorSummary ? new Error(rowErrorSummary) : undefined),
  );
  if (runError) throw runError;
  return result;
}
