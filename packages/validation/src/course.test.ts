import { describe, expect, test } from "bun:test";
import { coursePatchSchema, courseSchema } from "./course";

describe("coursePatchSchema", () => {
  test("accepts partial PATCH with only name, keeping omitted fields undefined", () => {
    const result = coursePatchSchema.safeParse({ name: "Updated Name" });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toEqual({
        name: "Updated Name",
        code: undefined,
        color: undefined,
        icon: undefined,
        description: undefined,
        updatedAt: undefined,
        updated_at: undefined,
      });
    }
  });

  test("accepts partial PATCH without name", () => {
    const descResult = coursePatchSchema.safeParse({ description: "New Info" });
    expect(descResult.success).toBe(true);
    if (descResult.success) {
      expect(descResult.data.description).toBe("New Info");
      expect(descResult.data.name).toBeUndefined();
    }

    const colorResult = coursePatchSchema.safeParse({ color: "#0066cc" });
    expect(colorResult.success).toBe(true);
    if (colorResult.success) {
      expect(colorResult.data.color).toBe("#0066cc");
      expect(colorResult.data.name).toBeUndefined();
    }
  });

  test("accepts empty payload {} with all fields undefined", () => {
    const result = coursePatchSchema.safeParse({});
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.name).toBeUndefined();
      expect(result.data.description).toBeUndefined();
      expect(result.data.code).toBeUndefined();
      expect(result.data.color).toBeUndefined();
      expect(result.data.icon).toBeUndefined();
    }
  });

  test("distinguishes explicit null from omitted fields", () => {
    const result = coursePatchSchema.safeParse({
      description: null,
      code: null,
      color: null,
      icon: null,
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.description).toBeNull();
      expect(result.data.code).toBeNull();
      expect(result.data.color).toBeNull();
      expect(result.data.icon).toBeNull();
      expect(result.data.name).toBeUndefined();
    }
  });

  test("rejects invalid name values (null, empty string, whitespace)", () => {
    expect(coursePatchSchema.safeParse({ name: null }).success).toBe(false);
    expect(coursePatchSchema.safeParse({ name: "" }).success).toBe(false);
    expect(coursePatchSchema.safeParse({ name: "   " }).success).toBe(false);
  });

  test("normalizes hex color and icon slug on PATCH", () => {
    const hex = coursePatchSchema.safeParse({ color: "0066cc" });
    expect(hex.success).toBe(true);
    if (hex.success) {
      expect(hex.data.color).toBe("#0066cc");
    }

    const icon = coursePatchSchema.safeParse({ icon: "Book-Open" });
    expect(icon.success).toBe(true);
    if (icon.success) {
      expect(icon.data.icon).toBe("book-open");
    }
  });

  test("rejects invalid color and icon on PATCH", () => {
    expect(coursePatchSchema.safeParse({ color: "blue" }).success).toBe(false);
    expect(coursePatchSchema.safeParse({ icon: "invalid_slug" }).success).toBe(false);
  });
});


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

  test("enforces name length limit (<= 255 chars)", () => {
    expect(courseSchema.safeParse({ name: "a".repeat(255) }).success).toBe(true);
    expect(courseSchema.safeParse({ name: "a".repeat(256) }).success).toBe(false);
  });

  test("enforces code length limit (<= 50 chars)", () => {
    expect(
      courseSchema.safeParse({ name: "Course", code: "c".repeat(50) }).success,
    ).toBe(true);
    expect(
      courseSchema.safeParse({ name: "Course", code: "c".repeat(51) }).success,
    ).toBe(false);
  });

  test("enforces description length limit (<= 5000 chars)", () => {
    expect(
      courseSchema.safeParse({ name: "Course", description: "d".repeat(5000) })
        .success,
    ).toBe(true);
    expect(
      courseSchema.safeParse({ name: "Course", description: "d".repeat(5001) })
        .success,
    ).toBe(false);
  });
});
