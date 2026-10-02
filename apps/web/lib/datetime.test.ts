import { describe, expect, test } from "bun:test";
import {
  formatDeadline,
  formatDeadlineTime,
  formatTime,
  formatterCacheSize,
  toDatetimeLocalValue,
  zonedWallToIso,
} from "./datetime";

describe("Intl formatter cache (F-11c)", () => {
  test("repeated formatting of the same shape reuses cached formatters", () => {
    formatTime("2026-09-15T14:30:00.000Z", "24h", "UTC");
    const sizeAfterFirst = formatterCacheSize();
    formatTime("2026-09-16T10:00:00.000Z", "24h", "UTC");
    formatTime("2026-09-17T11:00:00.000Z", "24h", "UTC");
    expect(formatterCacheSize()).toBe(sizeAfterFirst);
  });

  test("output is deterministic across repeated calls with the same shape", () => {
    const iso = "2026-09-15T14:30:00.000Z";
    expect(formatDeadline(iso, "Asia/Jakarta", "24h")).toBe(
      formatDeadline(iso, "Asia/Jakarta", "24h"),
    );
    expect(formatTime(iso, "12h", "UTC")).toBe(formatTime(iso, "12h", "UTC"));
  });
});

describe("toDatetimeLocalValue", () => {
  test("returns empty string for invalid input", () => {
    expect(toDatetimeLocalValue("not-a-date")).toBe("");
  });

  test("formats a valid ISO timestamp for datetime-local", () => {
    const value = toDatetimeLocalValue("2026-09-15T14:30:00.000Z");
    expect(value).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/);
    expect(Date.parse(value)).not.toBeNaN();
  });

  test("interprets the instant in the given timezone (#66)", () => {
    // 2026-09-29T23:30Z is 07:30 on Sep 30 in Asia/Makassar (UTC+8).
    expect(toDatetimeLocalValue("2026-09-29T23:30:00.000Z", "Asia/Makassar")).toBe(
      "2026-09-30T07:30",
    );
    expect(toDatetimeLocalValue("2026-09-29T23:30:00.000Z", "UTC")).toBe(
      "2026-09-29T23:30",
    );
  });
});

describe("zonedWallToIso", () => {
  test("converts a profile-TZ wall-clock to a UTC instant (#66)", () => {
    expect(zonedWallToIso("2026-09-30", "07:30", "Asia/Makassar")).toBe(
      "2026-09-29T23:30:00.000Z",
    );
    expect(zonedWallToIso("2026-09-30", "07:30", "UTC")).toBe(
      "2026-09-30T07:30:00.000Z",
    );
  });

  test("round-trips wall -> instant -> wall without shifting", () => {
    for (const [date, time, tz] of [
      ["2026-09-30", "07:30", "Asia/Makassar"],
      ["2026-09-30", "22:30", "Asia/Makassar"],
      ["2026-09-30", "00:00", "Asia/Makassar"],
      ["2026-09-30", "23:59", "Asia/Makassar"],
      ["2026-09-30", "07:30", "UTC"],
    ] as const) {
      const iso = zonedWallToIso(date, time, tz);
      expect(iso).not.toBe("");
      expect(toDatetimeLocalValue(iso, tz)).toBe(`${date}T${time}`);
    }
  });

  test("keeps midnight values on the same date in the profile TZ", () => {
    const midnight = zonedWallToIso("2026-09-30", "00:00", "Asia/Makassar");
    expect(toDatetimeLocalValue(midnight, "Asia/Makassar")).toBe(
      "2026-09-30T00:00",
    );
    const lastMinute = zonedWallToIso("2026-09-30", "23:59", "Asia/Makassar");
    expect(toDatetimeLocalValue(lastMinute, "Asia/Makassar")).toBe(
      "2026-09-30T23:59",
    );
  });

  test("returns empty string for invalid input", () => {
    expect(zonedWallToIso("", "07:30", "Asia/Makassar")).toBe("");
    expect(zonedWallToIso("2026-09-30", "", "Asia/Makassar")).toBe("");
    expect(zonedWallToIso("not-a-date", "07:30", "Asia/Makassar")).toBe("");
    expect(zonedWallToIso("2026-09-30", "25:00", "Asia/Makassar")).toBe("");
  });
});

describe("formatTime", () => {
  test.each([
    ["2026-09-15T00:00:00.000Z", "12:00 AM"],
    ["2026-09-15T00:01:00.000Z", "12:01 AM"],
    ["2026-09-15T09:05:00.000Z", "9:05 AM"],
    ["2026-09-15T11:59:00.000Z", "11:59 AM"],
    ["2026-09-15T12:00:00.000Z", "12:00 PM"],
    ["2026-09-15T12:01:00.000Z", "12:01 PM"],
    ["2026-09-15T14:30:00.000Z", "2:30 PM"],
    ["2026-09-15T23:59:00.000Z", "11:59 PM"],
  ])("formats %s as %s in 12h", (iso, expected) => {
    expect(formatTime(iso, "12h", "UTC")).toBe(expected);
  });

  test.each([
    ["2026-09-15T00:00:00.000Z", "00:00"],
    ["2026-09-15T09:05:00.000Z", "09:05"],
    ["2026-09-15T12:00:00.000Z", "12:00"],
    ["2026-09-15T14:30:00.000Z", "14:30"],
    ["2026-09-15T23:59:00.000Z", "23:59"],
  ])("formats %s as %s in 24h", (iso, expected) => {
    expect(formatTime(iso, "24h", "UTC")).toBe(expected);
  });

  test("defaults to 24h", () => {
    expect(formatTime("2026-09-15T14:30:00.000Z", undefined, "UTC")).toBe(
      "14:30",
    );
  });

  test("returns the raw ISO string for invalid input", () => {
    expect(formatTime("not-a-date", "24h")).toBe("not-a-date");
    expect(formatTime("not-a-date", "12h")).toBe("not-a-date");
  });

  test("resolves the same instant through the timezone in both formats", () => {
    // 14:30 UTC is 10:30 in New York (EDT, September).
    expect(formatTime("2026-09-15T14:30:00.000Z", "24h", "America/New_York")).toBe(
      "10:30",
    );
    expect(formatTime("2026-09-15T14:30:00.000Z", "12h", "America/New_York")).toBe(
      "10:30 AM",
    );
  });
});

describe("formatDeadlineTime", () => {
  test("respects the 24h preference", () => {
    expect(formatDeadlineTime("2026-09-15T14:30:00.000Z", "UTC", "24h")).toBe(
      "14:30",
    );
  });

  test("respects the 12h preference", () => {
    expect(
      formatDeadlineTime("2026-09-15T14:30:00.000Z", "UTC", "12h"),
    ).toBe("2:30 PM");
  });

  test("returns the raw ISO string for invalid input", () => {
    expect(formatDeadlineTime("not-a-date")).toBe("not-a-date");
  });
});

describe("formatDeadline", () => {
  test("formats deterministically in 24h by default", () => {
    expect(formatDeadline("2026-09-15T23:59:00.000Z", "UTC")).toBe(
      "Sep 15, 2026, 23:59",
    );
  });

  test("formats with AM/PM when 12h is selected", () => {
    expect(formatDeadline("2026-09-15T23:59:00.000Z", "UTC", "12h")).toBe(
      "Sep 15, 2026, 11:59 PM",
    );
  });

  test("renders midnight in both formats", () => {
    expect(formatDeadline("2026-09-15T00:00:00.000Z", "UTC", "24h")).toBe(
      "Sep 15, 2026, 00:00",
    );
    expect(formatDeadline("2026-09-15T00:00:00.000Z", "UTC", "12h")).toBe(
      "Sep 15, 2026, 12:00 AM",
    );
  });

  test("returns the raw ISO string for invalid input", () => {
    expect(formatDeadline("not-a-date")).toBe("not-a-date");
  });
});
