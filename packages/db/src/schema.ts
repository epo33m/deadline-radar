import {
  boolean,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  unique,
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
  "sent",
  "failed",
]);

export const attachmentTypeEnum = pgEnum("attachment_type", ["file", "link"]);

export const profiles = pgTable("profiles", {
  id: uuid("id").primaryKey(),
  email: text("email").notNull(),
  name: text("name"),
  timezone: text("timezone").notNull().default("UTC"),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
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

export const courses = pgTable("courses", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id")
    .notNull()
    .references(() => profiles.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  code: text("code"),
  color: text("color"),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
    .notNull()
    .defaultNow(),
  deletedAt: timestamp("deleted_at", { withTimezone: true, mode: "date" }),
});

export const tasks = pgTable("tasks", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id")
    .notNull()
    .references(() => profiles.id, { onDelete: "cascade" }),
  courseId: uuid("course_id")
    .notNull()
    .references(() => courses.id, { onDelete: "cascade" }),
  title: text("title").notNull(),
  description: text("description"),
  deadline: timestamp("deadline", { withTimezone: true, mode: "date" }).notNull(),
  status: taskStatusEnum("status").notNull().default("todo"),
  estimatedDuration: integer("estimated_duration"),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" })
    .notNull()
    .defaultNow(),
  deletedAt: timestamp("deleted_at", { withTimezone: true, mode: "date" }),
});

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
  },
  (table) => [unique().on(table.taskId, table.daysBefore)],
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
    channel: notificationChannelEnum("channel").notNull(),
    status: notificationStatusEnum("status").notNull().default("pending"),
    retryCount: integer("retry_count").notNull().default(0),
    sentAt: timestamp("sent_at", { withTimezone: true, mode: "date" }),
    readAt: timestamp("read_at", { withTimezone: true, mode: "date" }),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
  },
  (table) => [unique().on(table.thresholdId, table.channel)],
);

export const attachments = pgTable("attachments", {
  id: uuid("id").primaryKey().defaultRandom(),
  taskId: uuid("task_id")
    .notNull()
    .references(() => tasks.id, { onDelete: "cascade" }),
  type: attachmentTypeEnum("type").notNull(),
  name: text("name").notNull(),
  storagePath: text("storage_path"),
  url: text("url"),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
    .notNull()
    .defaultNow(),
});
