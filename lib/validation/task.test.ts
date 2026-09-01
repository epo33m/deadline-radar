import { describe, expect, test } from "bun:test";
import { taskSchema, taskStatusSchema } from "./task";

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
  test("accepts required fields with optional description and duration omitted", () => {
    const result = taskSchema.safeParse(validBase);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toEqual({
        title: "Essay draft",
        course_id: validBase.course_id,
        deadline: validBase.deadline,
        status: "todo",
        description: null,
        estimated_duration: null,
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

  test("accepts estimated_duration as a positive integer minutes value", () => {
    const result = taskSchema.safeParse({
      ...validBase,
      estimated_duration: "90",
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.estimated_duration).toBe(90);
    }
  });

  test("normalizes empty estimated_duration to null", () => {
    const result = taskSchema.safeParse({
      ...validBase,
      estimated_duration: "",
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.estimated_duration).toBeNull();
    }
  });

  test("rejects non-integer or non-positive estimated_duration", () => {
    expect(
      taskSchema.safeParse({ ...validBase, estimated_duration: "0" }).success,
    ).toBe(false);
    expect(
      taskSchema.safeParse({ ...validBase, estimated_duration: "-5" }).success,
    ).toBe(false);
    expect(
      taskSchema.safeParse({ ...validBase, estimated_duration: "1.5" }).success,
    ).toBe(false);
    expect(
      taskSchema.safeParse({ ...validBase, estimated_duration: "two" }).success,
    ).toBe(false);
  });

  test("allows any status including reopen to todo from done", () => {
    for (const status of ["todo", "in_progress", "done"] as const) {
      const result = taskSchema.safeParse({ ...validBase, status });
      expect(result.success).toBe(true);
    }
  });
});
