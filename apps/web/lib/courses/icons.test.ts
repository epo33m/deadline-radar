import { describe, expect, test } from "bun:test";

import {
  getAllCourseIconSlugs,
  getCourseIcon,
  getCourseIconLabel,
  isValidCourseIconSlug,
  NO_COURSE_ICON,
  normalizeCourseIconForStorage,
  pascalToSlug,
  slugToPascalCase,
  SUGGESTED_COURSE_ICONS,
} from "./icons";

describe("course icons", () => {
  test("slug converts to PascalCase and back", () => {
    expect(slugToPascalCase("book-open")).toBe("BookOpen");
    expect(slugToPascalCase("flask-conical")).toBe("FlaskConical");
    expect(pascalToSlug("BookOpen")).toBe("book-open");
    expect(pascalToSlug("FlaskConical")).toBe("flask-conical");
  });

  test("validates kebab-case slug format", () => {
    expect(isValidCourseIconSlug("book-open")).toBe(true);
    expect(isValidCourseIconSlug("Book-Open")).toBe(true);
    expect(isValidCourseIconSlug("")).toBe(false);
    expect(isValidCourseIconSlug(null)).toBe(false);
    expect(isValidCourseIconSlug("Book Open")).toBe(false);
    expect(isValidCourseIconSlug("book_open")).toBe(false);
    expect(isValidCourseIconSlug("a".repeat(65))).toBe(false);
  });

  test("resolves stored slugs to Lucide components", () => {
    expect(getCourseIcon("book-open")).not.toBeNull();
    expect(getCourseIcon("flask-conical")).not.toBeNull();
    expect(getCourseIcon(null)).toBeNull();
    expect(getCourseIcon("")).toBeNull();
    // Well-formed but unknown → fallback null (renders as None).
    expect(getCourseIcon("not-a-real-lucide-icon-xyz")).toBeNull();
  });

  test("labels suggestions and falls back to title case", () => {
    expect(getCourseIconLabel("")).toBe(NO_COURSE_ICON.label);
    expect(getCourseIconLabel(null)).toBe(NO_COURSE_ICON.label);
    expect(getCourseIconLabel("book-open")).toBe("Book");
    expect(getCourseIconLabel("alarm-clock")).toBe("Alarm Clock");
  });

  test("normalize keeps well-formed slugs, drops the rest", () => {
    expect(normalizeCourseIconForStorage("Book-Open")).toBe("book-open");
    expect(normalizeCourseIconForStorage("")).toBe("");
    expect(normalizeCourseIconForStorage(null)).toBe("");
    expect(normalizeCourseIconForStorage("Book Open")).toBe("");
  });

  test("suggestions use real Lucide slugs", () => {
    expect(SUGGESTED_COURSE_ICONS.length).toBeGreaterThan(0);
    for (const suggestion of SUGGESTED_COURSE_ICONS) {
      expect(getCourseIcon(suggestion.slug)).not.toBeNull();
    }
  });

  test("full Lucide set is searchable", () => {
    const slugs = getAllCourseIconSlugs();
    expect(slugs.length).toBeGreaterThan(1000);
    expect(slugs).toContain("book-open");
  });
});
