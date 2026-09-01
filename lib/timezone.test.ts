import { describe, expect, test } from "bun:test";
import {
  detectBrowserTimeZone,
  isValidTimeZone,
  timezoneSchema,
} from "./timezone";

describe("isValidTimeZone", () => {
  test("accepts a known IANA timezone", () => {
    expect(isValidTimeZone("Asia/Makassar")).toBe(true);
  });

  test("accepts UTC", () => {
    expect(isValidTimeZone("UTC")).toBe(true);
  });

  test("rejects an empty string", () => {
    expect(isValidTimeZone("")).toBe(false);
  });

  test("rejects a non-IANA timezone string", () => {
    expect(isValidTimeZone("Not/A_Zone")).toBe(false);
  });
});

describe("timezoneSchema", () => {
  test("accepts Asia/Makassar", () => {
    const result = timezoneSchema.safeParse("Asia/Makassar");
    expect(result.success).toBe(true);
  });

  test("rejects an invalid timezone", () => {
    const result = timezoneSchema.safeParse("Fake/Zone");
    expect(result.success).toBe(false);
  });
});

describe("detectBrowserTimeZone", () => {
  test("returns a valid IANA timezone", () => {
    const zone = detectBrowserTimeZone();
    expect(isValidTimeZone(zone)).toBe(true);
  });
});
