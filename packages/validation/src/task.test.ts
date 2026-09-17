import { describe, expect, test } from "bun:test";
import {
  reminderThresholdSchema,
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

  test("allows any status including reopen to todo from done", () => {
    for (const status of ["todo", "in_progress", "done"] as const) {
      const result = taskSchema.safeParse({ ...validBase, status });
      expect(result.success).toBe(true);
    }
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
});
