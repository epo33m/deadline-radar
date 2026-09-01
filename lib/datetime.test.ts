import { describe, expect, test } from "bun:test";
import { formatDeadline, toDatetimeLocalValue } from "./datetime";

describe("toDatetimeLocalValue", () => {
  test("returns empty string for invalid input", () => {
    expect(toDatetimeLocalValue("not-a-date")).toBe("");
  });

  test("formats a valid ISO timestamp for datetime-local", () => {
    const value = toDatetimeLocalValue("2026-09-15T14:30:00.000Z");
    expect(value).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/);
    expect(Date.parse(value)).not.toBeNaN();
  });
});

describe("formatDeadline", () => {
  test("returns a non-empty localized string for a valid ISO date", () => {
    const formatted = formatDeadline("2026-09-15T23:59:00.000Z");
    expect(formatted.length).toBeGreaterThan(0);
    expect(formatted).not.toBe("2026-09-15T23:59:00.000Z");
  });
});
