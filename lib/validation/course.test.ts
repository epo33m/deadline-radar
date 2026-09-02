import { describe, expect, test } from "bun:test";
import { courseSchema } from "./course";

describe("courseSchema", () => {
  test("accepts a required non-empty name with optional code and color omitted", () => {
    const result = courseSchema.safeParse({ name: "Algorithms" });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toEqual({
        name: "Algorithms",
        code: null,
        color: null,
      });
    }
  });

  test("trims name and rejects whitespace-only names", () => {
    const trimmed = courseSchema.safeParse({ name: "  Discrete Math  " });
    expect(trimmed.success).toBe(true);
    if (trimmed.success) {
      expect(trimmed.data.name).toBe("Discrete Math");
    }

    const blank = courseSchema.safeParse({ name: "   " });
    expect(blank.success).toBe(false);
  });

  test("rejects an empty name", () => {
    const result = courseSchema.safeParse({ name: "" });
    expect(result.success).toBe(false);
  });

  test("normalizes empty optional code and color to null", () => {
    const result = courseSchema.safeParse({
      name: "Physics",
      code: "  ",
      color: "",
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.code).toBeNull();
      expect(result.data.color).toBeNull();
    }
  });

  test("accepts null color when clearing to None", () => {
    const result = courseSchema.safeParse({
      name: "Physics",
      color: null,
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.color).toBeNull();
    }
  });

  test("accepts a trimmed code and a #RRGGBB color", () => {
    const result = courseSchema.safeParse({
      name: "Chemistry",
      code: "  CHEM101  ",
      color: "#0066cc",
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.code).toBe("CHEM101");
      expect(result.data.color).toBe("#0066cc");
    }
  });

  test("rejects invalid color values", () => {
    expect(
      courseSchema.safeParse({ name: "History", color: "blue" }).success,
    ).toBe(false);
    expect(
      courseSchema.safeParse({ name: "History", color: "#abc" }).success,
    ).toBe(false);
    expect(
      courseSchema.safeParse({ name: "History", color: "#GGGGGG" }).success,
    ).toBe(false);
  });

  test("allows duplicate names (identity is course id, not name)", () => {
    const a = courseSchema.safeParse({ name: "Seminar" });
    const b = courseSchema.safeParse({ name: "Seminar" });
    expect(a.success).toBe(true);
    expect(b.success).toBe(true);
  });
});
