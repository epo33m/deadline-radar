import { describe, expect, test } from "bun:test";
import { courses, profiles, timeFormatEnum } from "./schema";

describe("profiles.timeFormat", () => {
  test("enum only allows 24h and 12h", () => {
    expect(timeFormatEnum.enumValues).toEqual(["24h", "12h"]);
  });

  test("column is NOT NULL with a 24h default (existing rows backfill safely)", () => {
    expect(profiles.timeFormat.notNull).toBe(true);
    expect(profiles.timeFormat.default).toBe("24h");
  });
});

describe("courses.icon", () => {
  test("column is nullable text with no default (existing rows stay NULL)", () => {
    expect(courses.icon.notNull).toBe(false);
    expect(courses.icon.default).toBeUndefined();
  });
});
