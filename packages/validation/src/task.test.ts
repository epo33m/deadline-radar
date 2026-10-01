import { describe, expect, test } from "bun:test";
import {
  MAX_DAYS_BEFORE,
  reminderThresholdSchema,
  reminderThresholdsPutSchema,
  taskSchema,
  taskStatusSchema,
} from "./task";

const validBase = {
  title: "Essay draft",
  course_id: "11111111-1111-4111-8111-111111111111",
  deadline: "2026-09-15T23:59:00.000Z",
  status: "todo" as const,
};

describe("taskStatusSchema", () => {
  test("accepts todo, in_progress, and done", () => {
    expect(taskStatusSchema.safeParse("todo").success).toBe(true);
    expect(taskStatusSchema.safeParse("in_progress").success).toBe(true);
    expect(taskStatusSchema.safeParse("done").success).toBe(true);
  });

  test("rejects unknown status values", () => {
    expect(taskStatusSchema.safeParse("blocked").success).toBe(false);
    expect(taskStatusSchema.safeParse("").success).toBe(false);
  });
});

describe("taskSchema", () => {
  test("accepts required fields with optional description omitted", () => {
    const result = taskSchema.safeParse(validBase);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toEqual({
        title: "Essay draft",
        course_id: validBase.course_id,
        deadline: validBase.deadline,
        status: "todo",
        description: null,
      });
    }
  });

  test("trims title and rejects whitespace-only titles", () => {
    const trimmed = taskSchema.safeParse({
      ...validBase,
      title: "  Midterm review  ",
    });
    expect(trimmed.success).toBe(true);
    if (trimmed.success) {
      expect(trimmed.data.title).toBe("Midterm review");
    }

    expect(
      taskSchema.safeParse({ ...validBase, title: "   " }).success,
    ).toBe(false);
  });

  test("rejects an empty title", () => {
    expect(taskSchema.safeParse({ ...validBase, title: "" }).success).toBe(
      false,
    );
  });

  test("rejects a non-uuid course_id", () => {
    expect(
      taskSchema.safeParse({ ...validBase, course_id: "not-a-uuid" }).success,
    ).toBe(false);
  });

  test("rejects an invalid deadline", () => {
    expect(
      taskSchema.safeParse({ ...validBase, deadline: "soon" }).success,
    ).toBe(false);
  });

  test("accepts offset-aware deadlines (Z and numeric offset)", () => {
    expect(
      taskSchema.safeParse({
        ...validBase,
        deadline: "2026-09-30T07:30:00+08:00",
      }).success,
    ).toBe(true);
    const normalized = taskSchema.safeParse({
      ...validBase,
      deadline: "2026-09-30T07:30:00+08:00",
    });
    expect(normalized.success).toBe(true);
    if (normalized.success) {
      // 07:30 in UTC+8 == 23:30Z on the previous day.
      expect(normalized.data.deadline).toBe("2026-09-29T23:30:00.000Z");
    }
  });

  test("rejects offset-naive wall-clock strings (#66)", () => {
    // What TaskForm used to send: parsed in the server process TZ, so the
    // stored instant shifted whenever server TZ != profile TZ.
    for (const wall of [
      "2026-09-30T07:30",
      "2026-09-30T07:30:00",
      "2026-09-30 07:30",
    ]) {
      const result = taskSchema.safeParse({ ...validBase, deadline: wall });
      expect(result.success).toBe(false);
    }
  });

  test("normalizes empty optional description to null", () => {
    const result = taskSchema.safeParse({
      ...validBase,
      description: "  ",
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.description).toBeNull();
    }
  });

  test("trims a non-empty description", () => {
    const result = taskSchema.safeParse({
      ...validBase,
      description: "  First draft notes  ",
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.description).toBe("First draft notes");
    }
  });

  test("rejects the removed estimated_duration field (strict schema)", () => {
    expect(
      taskSchema.safeParse({ ...validBase, estimated_duration: 90 }).success,
    ).toBe(false);
  });

  test("allows only active statuses on create; done must go through Mark as done", () => {
    for (const status of ["todo", "in_progress"] as const) {
      const result = taskSchema.safeParse({ ...validBase, status });
      expect(result.success).toBe(true);
    }
    expect(
      taskSchema.safeParse({ ...validBase, status: "done" }).success,
    ).toBe(false);
  });

  test("enforces title length limit (<= 255 chars)", () => {
    const exactly255 = taskSchema.safeParse({
      ...validBase,
      title: "a".repeat(255),
    });
    expect(exactly255.success).toBe(true);

    const over255 = taskSchema.safeParse({
      ...validBase,
      title: "a".repeat(256),
    });
    expect(over255.success).toBe(false);
  });

  test("enforces description length limit (<= 5000 chars)", () => {
    const exactly5000 = taskSchema.safeParse({
      ...validBase,
      description: "d".repeat(5000),
    });
    expect(exactly5000.success).toBe(true);

    const over5000 = taskSchema.safeParse({
      ...validBase,
      description: "d".repeat(5001),
    });
    expect(over5000.success).toBe(false);
  });
});

describe("reminderThresholdSchema", () => {
  test("accepts days_before of 0 and positive integers", () => {
    expect(reminderThresholdSchema.safeParse({ days_before: "0" }).success).toBe(
      true,
    );
    expect(reminderThresholdSchema.safeParse({ days_before: "14" }).success).toBe(
      true,
    );
    expect(reminderThresholdSchema.safeParse({ days_before: 5 }).success).toBe(
      true,
    );
  });

  test("parses string days_before to a number", () => {
    const result = reminderThresholdSchema.safeParse({ days_before: "7" });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.days_before).toBe(7);
    }
  });

  test("rejects negative, fractional, and non-numeric days_before", () => {
    expect(
      reminderThresholdSchema.safeParse({ days_before: "-1" }).success,
    ).toBe(false);
    expect(
      reminderThresholdSchema.safeParse({ days_before: "1.5" }).success,
    ).toBe(false);
    expect(
      reminderThresholdSchema.safeParse({ days_before: "two" }).success,
    ).toBe(false);
    expect(reminderThresholdSchema.safeParse({ days_before: "" }).success).toBe(
      false,
    );
  });

  test("caps days_before at MAX_DAYS_BEFORE (both forms)", () => {
    expect(
      reminderThresholdSchema.safeParse({ days_before: MAX_DAYS_BEFORE })
        .success,
    ).toBe(true);
    expect(
      reminderThresholdSchema.safeParse({
        days_before: String(MAX_DAYS_BEFORE),
      }).success,
    ).toBe(true);
    // Previously accepted, then failed inside the database integer column.
    expect(
      reminderThresholdSchema.safeParse({ days_before: MAX_DAYS_BEFORE + 1 })
        .success,
    ).toBe(false);
    expect(
      reminderThresholdSchema.safeParse({ days_before: 9999999999 }).success,
    ).toBe(false);
    expect(
      reminderThresholdSchema.safeParse({ days_before: "9999999999" }).success,
    ).toBe(false);
  });
});

describe("reminderThresholdsPutSchema", () => {
  test("accepts an empty thresholds array", () => {
    const result = reminderThresholdsPutSchema.safeParse({ thresholds: [] });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.thresholds).toEqual([]);
    }
  });

  test("accepts multiple valid thresholds", () => {
    const result = reminderThresholdsPutSchema.safeParse({
      thresholds: [
        { days_before: 7 },
        { days_before: "3" },
        { days_before: 1 },
        { days_before: 0 },
      ],
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.thresholds).toEqual([
        { days_before: 7 },
        { days_before: 3 },
        { days_before: 1 },
        { days_before: 0 },
      ]);
    }
  });

  test("rejects duplicate days_before in array", () => {
    const result = reminderThresholdsPutSchema.safeParse({
      thresholds: [{ days_before: 3 }, { days_before: "3" }],
    });
    expect(result.success).toBe(false);
  });

  test("rejects invalid days_before inside array", () => {
    const result = reminderThresholdsPutSchema.safeParse({
      thresholds: [{ days_before: -1 }],
    });
    expect(result.success).toBe(false);
  });

  test("rejects unexpected properties due to strict schema", () => {
    const result = reminderThresholdsPutSchema.safeParse({
      thresholds: [{ days_before: 3, extra: "bad" }],
    });
    expect(result.success).toBe(false);
  });
});

