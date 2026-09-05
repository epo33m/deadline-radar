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
  test("formats deterministically for a fixed locale and timezone", () => {
    expect(formatDeadline("2026-09-15T23:59:00.000Z", "UTC")).toBe(
      "Sep 15, 2026 at 11:59 PM",
    );
  });

  test("returns the raw ISO string for invalid input", () => {
    expect(formatDeadline("not-a-date")).toBe("not-a-date");
  });
});
