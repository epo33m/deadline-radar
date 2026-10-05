import { describe, expect, test } from "bun:test";
import {
  attachments,
  courses,
  notificationDeliveries,
  profiles,
  reminderRuns,
  reminderThresholds,
  tasks,
  timeFormatEnum,
} from "./schema";
import { getTableConfig } from "drizzle-orm/pg-core";

describe("profiles.timeFormat", () => {
  test("enum only allows 24h and 12h", () => {
    expect(timeFormatEnum.enumValues).toEqual(["24h", "12h"]);
  });

  test("column is NOT NULL with a 24h default (existing rows backfill safely)", () => {
    expect(profiles.timeFormat.notNull).toBe(true);
    expect(profiles.timeFormat.default).toBe("24h");
  });
});

describe("courses.icon", () => {
  test("column is nullable text with no default (existing rows stay NULL)", () => {
    expect(courses.icon.notNull).toBe(false);
    expect(courses.icon.default).toBeUndefined();
  });
});

describe("H-2 schema constraints", () => {
  test("courses has UNIQUE(id, user_id) constraint", () => {
    const config = getTableConfig(courses);
    const uniqueConstraint = config.uniqueConstraints.find(
      (u) => u.name === "courses_id_user_id_key",
    );
    expect(uniqueConstraint).toBeDefined();
    const cols = uniqueConstraint!.columns.map((c) => c.name);
    expect(cols).toEqual(["id", "user_id"]);
  });

  test("tasks has composite foreignKey(course_id, user_id) -> courses(id, user_id)", () => {
    const config = getTableConfig(tasks);
    const fk = config.foreignKeys.find(
      (f) => f.getName() === "tasks_course_id_user_id_fkey",
    );
    expect(fk).toBeDefined();
    const reference = fk!.reference();
    const colNames = reference.columns.map((c) => c.name);
    const foreignColNames = reference.foreignColumns.map((c) => c.name);
    expect(colNames).toEqual(["course_id", "user_id"]);
    expect(foreignColNames).toEqual(["id", "user_id"]);
    expect(fk!.onDelete).toBe("cascade");
  });
});

describe("M-4 notification_deliveries schema constraints", () => {
  test("notification_deliveries has days_before NOT NULL column", () => {
    expect(notificationDeliveries.daysBefore.notNull).toBe(true);
  });

  test("notification_deliveries has UNIQUE(threshold_id, days_before, channel) constraint", () => {
    const config = getTableConfig(notificationDeliveries);
    const uniqueConstraint = config.uniqueConstraints[0];
    expect(uniqueConstraint).toBeDefined();
    const cols = uniqueConstraint!.columns.map((c) => c.name);
    expect(cols).toEqual(["threshold_id", "days_before", "channel"]);
  });
});

describe("M-8 schema constraints", () => {
  test("courses has UNIQUE(id, user_id) constraint", () => {
    const config = getTableConfig(courses);
    const uniqueConstraint = config.uniqueConstraints.find(
      (u) => u.name === "courses_id_user_id_key",
    );
    expect(uniqueConstraint).toBeDefined();
  });

  test("tasks has composite foreign key to courses(id, user_id)", () => {
    const config = getTableConfig(tasks);
    const fk = config.foreignKeys.find(
      (f) => f.getName() === "tasks_course_id_user_id_fkey",
    );
    expect(fk).toBeDefined();
  });
});

describe("M-9 query list indexes", () => {
  test("tasks has idx_tasks_user_deadline_id_active composite partial index", () => {
    const config = getTableConfig(tasks);
    const idx = config.indexes.find(
      (i) => i.config.name === "idx_tasks_user_deadline_id_active",
    );
    expect(idx).toBeDefined();
    expect(idx!.config.name).toBe("idx_tasks_user_deadline_id_active");
  });

  test("#133: attachments has partial idx_attachments_storage_path index", () => {
    const config = getTableConfig(attachments);
    const idx = config.indexes.find(
      (i) => i.config.name === "idx_attachments_storage_path",
    );
    expect(idx).toBeDefined();
    expect(idx!.config.unique).toBe(false);
    expect(idx!.config.where).toBeDefined();
  });

  test("courses has idx_courses_user_created_id_active composite partial index", () => {
    const config = getTableConfig(courses);
    const idx = config.indexes.find(
      (i) => i.config.name === "idx_courses_user_created_id_active",
    );
    expect(idx).toBeDefined();
    expect(idx!.config.name).toBe("idx_courses_user_created_id_active");
  });

  test("notification_deliveries has idx_notification_deliveries_in_app_sent composite partial index", () => {
    const config = getTableConfig(notificationDeliveries);
    const idx = config.indexes.find(
      (i) => i.config.name === "idx_notification_deliveries_in_app_sent",
    );
    expect(idx).toBeDefined();
    expect(idx!.config.name).toBe("idx_notification_deliveries_in_app_sent");
  });
});

describe("profiles.updatedAt", () => {
  test("column is NOT NULL with defaultNow", () => {
    expect(profiles.updatedAt.notNull).toBe(true);
    expect(profiles.updatedAt.default).toBeDefined();
  });
});

describe("RF-01 reminder_runs checkpoint", () => {
  test("last_seen_task_id is nullable uuid with no default (legacy rows stay NULL)", () => {
    expect(reminderRuns.lastSeenTaskId.notNull).toBe(false);
    expect(reminderRuns.lastSeenTaskId.default).toBeUndefined();
  });
});

describe("RF-12 reminder_runs truncation marker", () => {
  test("truncated is NOT NULL boolean defaulting to false (legacy rows read false)", () => {
    expect(reminderRuns.truncated.notNull).toBe(true);
    expect(reminderRuns.truncated.dataType).toBe("boolean");
    expect(reminderRuns.truncated.default).toBe(false);
  });
});

describe("RF-02 notification_deliveries email snapshots", () => {
  test("email_snapshot is nullable jsonb with no default (legacy rows stay NULL)", () => {
    expect(notificationDeliveries.emailSnapshot.notNull).toBe(false);
    expect(notificationDeliveries.emailSnapshot.default).toBeUndefined();
  });

  test("email_idempotency_key is nullable text with no default", () => {
    expect(notificationDeliveries.emailIdempotencyKey.notNull).toBe(false);
    expect(notificationDeliveries.emailIdempotencyKey.default).toBeUndefined();
  });
});

describe("RF-04 reminder_runs single-flight index", () => {
  test("reminder_runs has partial unique reminder_runs_single_active index", () => {
    const config = getTableConfig(reminderRuns);
    const idx = config.indexes.find(
      (i) => i.config.name === "reminder_runs_single_active",
    );
    expect(idx).toBeDefined();
    expect(idx!.config.unique).toBe(true);
  });
});

describe("RF-09 reminder_thresholds archive", () => {
  test("deleted_at is nullable with no default (live rows stay NULL)", () => {
    expect(reminderThresholds.deletedAt.notNull).toBe(false);
    expect(reminderThresholds.deletedAt.default).toBeUndefined();
  });

  test("unique (task_id, days_before) is a partial index over live rows only", () => {
    const config = getTableConfig(reminderThresholds);
    const idx = config.indexes.find(
      (i) => i.config.name === "reminder_thresholds_task_days_before_active_key",
    );
    expect(idx).toBeDefined();
    expect(idx!.config.unique).toBe(true);
    expect(idx!.config.columns.map((c) => (c as { name: string }).name)).toEqual([
      "task_id",
      "days_before",
    ]);
  });
});


