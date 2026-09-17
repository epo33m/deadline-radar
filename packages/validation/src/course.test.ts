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
        icon: null,
        description: null,
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

  test("normalizes empty optional code, color, and description to null", () => {
    const result = courseSchema.safeParse({
      name: "Physics",
      code: "  ",
      color: "",
      description: "  ",
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.code).toBeNull();
      expect(result.data.color).toBeNull();
      expect(result.data.description).toBeNull();
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

  test("accepts null code and description when cleared", () => {
    const result = courseSchema.safeParse({
      name: "Physics",
      code: null,
      description: null,
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.code).toBeNull();
      expect(result.data.description).toBeNull();
    }
  });

  test("accepts a trimmed code and a #RRGGBB color with a trimmed description", () => {
    const result = courseSchema.safeParse({
      name: "Chemistry",
      code: "  CHEM101  ",
      color: "#0066cc",
      description: "  Organic chemistry fundamentals  ",
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.code).toBe("CHEM101");
      expect(result.data.color).toBe("#0066cc");
      expect(result.data.description).toBe("Organic chemistry fundamentals");
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

  test("normalizes empty icon to null and lowercases slugs", () => {
    const empty = courseSchema.safeParse({ name: "Physics", icon: "" });
    expect(empty.success).toBe(true);
    if (empty.success) {
      expect(empty.data.icon).toBeNull();
    }

    const cleared = courseSchema.safeParse({ name: "Physics", icon: null });
    expect(cleared.success).toBe(true);
    if (cleared.success) {
      expect(cleared.data.icon).toBeNull();
    }

    const slug = courseSchema.safeParse({ name: "Physics", icon: "Book-Open" });
    expect(slug.success).toBe(true);
    if (slug.success) {
      expect(slug.data.icon).toBe("book-open");
    }
  });

  test("rejects invalid icon values", () => {
    expect(
      courseSchema.safeParse({ name: "History", icon: "Book Open" }).success,
    ).toBe(false);
    expect(
      courseSchema.safeParse({ name: "History", icon: "book_open" }).success,
    ).toBe(false);
    expect(
      courseSchema.safeParse({ name: "History", icon: "a".repeat(65) }).success,
    ).toBe(false);
  });
});
