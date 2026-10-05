import { sql } from "drizzle-orm";
import {
  boolean,
  foreignKey,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

export const taskStatusEnum = pgEnum("task_status", [
  "todo",
  "in_progress",
  "done",
]);

export const notificationChannelEnum = pgEnum("notification_channel", [
  "email",
  "in_app",
]);

export const notificationStatusEnum = pgEnum("notification_status", [
  "pending",
  "sending",
  "sent",
  "failed",
]);

export const attachmentTypeEnum = pgEnum("attachment_type", ["file", "link"]);

/**
 * RF-02: the exact email body inputs for one delivery, frozen on the first
 * send attempt so every later retry rebuilds the same body (and therefore the
 * same provider idempotency key) even after the task is edited.
 */
export type EmailDeliverySnapshot = {
  title: string;
  deadlineIso: string;
  timeZone: string;
  daysBefore: number;
  /** RF-11: frozen "late" label (scheduler catch-up). Absent on snapshots
   * written before this field existed → treated as false. */
  late?: boolean;
};

export const timeFormatEnum = pgEnum("time_format", ["24h", "12h"]);

export const profiles = pgTable("profiles", {
  id: uuid("id").primaryKey(),
  email: text("email").notNull(),
  name: text("name"),
  timezone: text("timezone").notNull().default("UTC"),
  timeFormat: timeFormatEnum("time_format").notNull().default("24h"),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" })
    .notNull()
    .defaultNow(),
});

/** Append-only auth security events. Never store secrets/tokens/passwords. */
export const authAuditEvents = pgTable("auth_audit_events", {
  id: uuid("id").primaryKey().defaultRandom(),
  event: text("event").notNull(),
  userId: uuid("user_id"),
  sessionId: text("session_id"),
  result: text("result").notNull(),
  method: text("method"),
  ip: text("ip"),
  userAgent: text("user_agent"),
  requestId: text("request_id"),
  metadata: jsonb("metadata").$type<Record<string, unknown>>(),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
    .notNull()
    .defaultNow(),
});

/** RBAC roles. Flat — no inheritance. */
export const roles = pgTable("roles", {
  id: uuid("id").primaryKey().defaultRandom(),
  slug: text("slug").notNull().unique(),
  description: text("description"),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
    .notNull()
    .defaultNow(),
});

export const roleCapabilities = pgTable(
  "role_capabilities",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    roleId: uuid("role_id")
      .notNull()
      .references(() => roles.id, { onDelete: "cascade" }),
    capability: text("capability").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
  },
  (table) => [unique().on(table.roleId, table.capability)],
);

export const userRoles = pgTable(
  "user_roles",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => profiles.id, { onDelete: "cascade" }),
    roleId: uuid("role_id")
      .notNull()
      .references(() => roles.id, { onDelete: "cascade" }),
    assignedAt: timestamp("assigned_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
    assignedBy: uuid("assigned_by").references(() => profiles.id, {
      onDelete: "set null",
    }),
  },
  (table) => [unique().on(table.userId, table.roleId)],
);

export const courses = pgTable(
  "courses",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => profiles.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    code: text("code"),
    color: text("color"),
    icon: text("icon"),
    description: text("description"),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
    deletedAt: timestamp("deleted_at", { withTimezone: true, mode: "date" }),
  },
  (table) => [
    unique("courses_id_user_id_key").on(table.id, table.userId),
    index("idx_courses_user_created_id_active")
      .on(table.userId, table.createdAt.desc(), table.id.desc())
      .where(sql`deleted_at IS NULL`),
  ],
);

/** Idempotency keys for mutating POSTs (24h TTL). Scoped per user. */
export const idempotencyKeys = pgTable(
  "idempotency_keys",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => profiles.id, { onDelete: "cascade" }),
    key: text("key").notNull(),
    method: text("method").notNull(),
    path: text("path").notNull(),
    requestHash: text("request_hash").notNull(),
    responseStatus: integer("response_status"),
    responseBody: jsonb("response_body").$type<Record<string, unknown>>(),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
    expiresAt: timestamp("expires_at", { withTimezone: true, mode: "date" })
      .notNull(),
  },
  (table) => [
    unique().on(table.userId, table.key),
    index("idempotency_keys_expires_at_idx").on(table.expiresAt),
  ],
);

export const tasks = pgTable(
  "tasks",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => profiles.id, { onDelete: "cascade" }),
    courseId: uuid("course_id").notNull(),
    title: text("title").notNull(),
    description: text("description"),
    deadline: timestamp("deadline", { withTimezone: true, mode: "date" }).notNull(),
    status: taskStatusEnum("status").notNull().default("todo"),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
    /** Last time the deadline value changed. Bumped only by deadline edits
     * (not title/status/course), so the reminder evaluator can skip
     * thresholds whose new trigger was already past at edit time (DOMAIN.md §4). */
    deadlineUpdatedAt: timestamp("deadline_updated_at", {
      withTimezone: true,
      mode: "date",
    })
      .notNull()
      .defaultNow(),
    completedAt: timestamp("completed_at", { withTimezone: true, mode: "date" }),
    deletedAt: timestamp("deleted_at", { withTimezone: true, mode: "date" }),
  },
  (table) => [
    foreignKey({
      columns: [table.courseId, table.userId],
      foreignColumns: [courses.id, courses.userId],
      name: "tasks_course_id_user_id_fkey",
    }).onDelete("cascade"),
    index("idx_tasks_user_deadline_id_active")
      .on(table.userId, table.deadline.asc(), table.id.asc())
      .where(sql`deleted_at IS NULL`),
    // P3: course-filtered list + date window (equality + equality + range).
    index("idx_tasks_user_course_deadline_active")
      .on(table.userId, table.courseId, table.deadline.asc())
      .where(sql`deleted_at IS NULL`),
  ],
);

export const reminderThresholds = pgTable(
  "reminder_thresholds",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    taskId: uuid("task_id")
      .notNull()
      .references(() => tasks.id, { onDelete: "cascade" }),
    daysBefore: integer("days_before").notNull(),
    isDefault: boolean("is_default").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
    /** Last time the offset changed. Bumped on PATCH; lets the evaluator
     * skip default thresholds whose new trigger was already past at edit
     * time (DOMAIN.md §4). */
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
    /** RF-09: NULL = live, timestamp = archived. Removals soft-delete so the
     * cascade to notification_deliveries never destroys delivery history. */
    deletedAt: timestamp("deleted_at", { withTimezone: true, mode: "date" }),
  },
  (table) => [
    // RF-09: unique only among live rows, so an archived offset can be
    // re-added later (and its sent history still suppresses a re-send).
    uniqueIndex("reminder_thresholds_task_days_before_active_key")
      .on(table.taskId, table.daysBefore)
      .where(sql`deleted_at IS NULL`),
  ],
);

export const notificationDeliveries = pgTable(
  "notification_deliveries",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    taskId: uuid("task_id")
      .notNull()
      .references(() => tasks.id, { onDelete: "cascade" }),
    thresholdId: uuid("threshold_id")
      .notNull()
      .references(() => reminderThresholds.id, { onDelete: "cascade" }),
    daysBefore: integer("days_before").notNull(),
    channel: notificationChannelEnum("channel").notNull(),
    status: notificationStatusEnum("status").notNull().default("pending"),
    retryCount: integer("retry_count").notNull().default(0),
    sentAt: timestamp("sent_at", { withTimezone: true, mode: "date" }),
    readAt: timestamp("read_at", { withTimezone: true, mode: "date" }),
    /**
     * F-05 failure context (observability only): message from the most
     * recent failed attempt (truncated, no PII) + when it happened.
     * NULL means no recorded failure. Overwritten on every markFailed so
     * both columns always describe the same latest attempt.
     */
    lastError: text("last_error"),
    failedAt: timestamp("failed_at", { withTimezone: true, mode: "date" }),
    /**
     * F-10 sweep-claim lease: when a run claimed this row for sending.
     * NULL means never claimed. A later run may reclaim a `sending` row
     * whose lease is stale (crashed claimant); freshness is evaluated in
     * code against SENDING_CLAIM_STALE_MS, not in the schema.
     */
    claimedAt: timestamp("claimed_at", { withTimezone: true, mode: "date" }),
    /**
     * RF-02: email body inputs frozen on the first send attempt. Retries
     * rebuild the email from this snapshot instead of live task fields, so
     * the provider idempotency key stays stable across scheduler runs.
     * NULL on legacy rows and on deliveries that never reached a send.
     */
    emailSnapshot: jsonb("email_snapshot").$type<EmailDeliverySnapshot>(),
    /**
     * RF-02: exact provider idempotency key to reuse. Written with the frozen
     * body; rewritten (rotated) only when the provider terminally rejects the
     * key, so a poisoned key can still deliver on the next retry. NULL on
     * legacy rows.
     */
    emailIdempotencyKey: text("email_idempotency_key"),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    unique().on(table.thresholdId, table.daysBefore, table.channel),
    index("idx_notification_deliveries_in_app_sent")
      .on(table.taskId, table.sentAt.desc(), table.id.desc())
      .where(sql`channel = 'in_app' AND status = 'sent'`),
  ],
);

/**
 * Scheduler run ledger (F-04, observability only).
 *
 * One row per `runEvaluateReminders()` execution: written at start
 * (`started_at`, status `running`), finalized in a finally block
 * (`finished_at`, counts, status `ok`/`error`). Never consulted for
 * skip/catch-up logic — the scheduler stays stateless; this table only
 * lets operators distinguish "processed, zero deliveries" from
 * "scheduler never ran" and crashes from silence. No purge (volume is
 * ~9k rows/year).
 */
export const reminderRuns = pgTable(
  "reminder_runs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    startedAt: timestamp("started_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
    finishedAt: timestamp("finished_at", { withTimezone: true, mode: "date" }),
    evaluatedTasks: integer("evaluated_tasks").notNull().default(0),
    created: integer("created").notNull().default(0),
    retried: integer("retried").notNull().default(0),
    emailsSent: integer("emails_sent").notNull().default(0),
    emailsFailed: integer("emails_failed").notNull().default(0),
    emailsSkippedQuota: integer("emails_skipped_quota").notNull().default(0),
    status: text("status").notNull().default("running"),
    error: text("error"),
    /** RF-01: last fully-processed task id, for post-crash resume (observability only). */
    lastSeenTaskId: uuid("last_seen_task_id"),
    /** RF-12: run hit MAX_TASKS_PER_RUN / MAX_RUN_DURATION_MS and stopped
      * gracefully; remaining due tasks are picked up by the next run. */
    truncated: boolean("truncated").notNull().default(false),
  },
  (table) => [
    index("idx_reminder_runs_started_at").on(table.startedAt.desc()),
    /**
     * RF-04: single-flight guard — at most one `running` row at a time, so
     * overlapping scheduler runs cannot each spend the per-user per-run email
     * budget. Stale `running` rows (crashed runs) are reclaimed in code.
     */
    uniqueIndex("reminder_runs_single_active")
      .on(table.status)
      .where(sql`status = 'running'`),
  ],
);

export const attachments = pgTable(
  "attachments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    taskId: uuid("task_id")
      .notNull()
      .references(() => tasks.id, { onDelete: "cascade" }),
    type: attachmentTypeEnum("type").notNull(),
    notes: text("notes"),
    storagePath: text("storage_path"),
    url: text("url"),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    // P3: task-scoped file lookups (detail view + ownership join).
    index("idx_attachments_task_id").on(table.taskId),
    // Issue #133: exact storage-sweep membership lookups by storage_path.
    index("idx_attachments_storage_path")
      .on(table.storagePath)
      .where(sql`storage_path is not null`),
  ],
);
