import { describe, expect, test } from "bun:test";
import {
  detectBrowserTimeZone,
  formatUtcOffset,
  isValidTimeZone,
  listTimeZones,
  parseTimezoneMode,
  resolveTimezoneForSave,
  searchTimeZones,
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

  test("rejects an invalid timezone with user-facing copy", () => {
    const result = timezoneSchema.safeParse("Fake/Zone");
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]?.message).toBe("Enter a valid timezone");
      expect(result.error.issues[0]?.message).not.toMatch(/IANA/i);
    }
  });
});

describe("detectBrowserTimeZone", () => {
  test("returns a valid IANA timezone", () => {
    const zone = detectBrowserTimeZone();
    expect(isValidTimeZone(zone)).toBe(true);
  });
});

describe("listTimeZones", () => {
  test("returns sorted unique IANA timezone identifiers", () => {
    const zones = listTimeZones();
    expect(zones.length).toBeGreaterThan(100);
    expect(zones).toContain("Asia/Makassar");
    expect(zones).toContain("UTC");
    expect(zones).toEqual([...zones].sort((a, b) => a.localeCompare(b)));
    expect(new Set(zones).size).toBe(zones.length);
  });
});

describe("formatUtcOffset", () => {
  test("formats Asia/Makassar as GMT+08:00", () => {
    // Fixed winter date avoids DST ambiguity for zones that observe it.
    const at = new Date("2024-01-15T12:00:00.000Z");
    expect(formatUtcOffset("Asia/Makassar", at)).toBe("GMT+08:00");
  });

  test("formats America/New_York winter offset as GMT-05:00", () => {
    const at = new Date("2024-01-15T12:00:00.000Z");
    expect(formatUtcOffset("America/New_York", at)).toBe("GMT-05:00");
  });

  test("formats UTC as GMT+00:00", () => {
    const at = new Date("2024-01-15T12:00:00.000Z");
    expect(formatUtcOffset("UTC", at)).toBe("GMT+00:00");
  });
});

describe("searchTimeZones", () => {
  const catalog = [
    "Asia/Jakarta",
    "Asia/Jayapura",
    "Asia/Makassar",
    "Asia/Pontianak",
    "Europe/London",
    "UTC",
  ];

  test("filters by case-insensitive substring", () => {
    expect(searchTimeZones("makassar", catalog)).toEqual(["Asia/Makassar"]);
    expect(searchTimeZones("ASIA/J", catalog)).toEqual([
      "Asia/Jakarta",
      "Asia/Jayapura",
    ]);
  });

  test("returns the full catalog when the query is blank", () => {
    expect(searchTimeZones("  ", catalog)).toEqual(catalog);
  });

  test("matches GMT offset text", () => {
    const at = new Date("2024-01-15T12:00:00.000Z");
    expect(searchTimeZones("GMT+08", catalog, at)).toEqual(["Asia/Makassar"]);
  });
});

describe("parseTimezoneMode", () => {
  test("treats automatic as automatic", () => {
    expect(parseTimezoneMode("automatic")).toBe("automatic");
  });

  test("treats anything else as manual", () => {
    expect(parseTimezoneMode("manual")).toBe("manual");
    expect(parseTimezoneMode(null)).toBe("manual");
    expect(parseTimezoneMode("")).toBe("manual");
    expect(parseTimezoneMode("weird")).toBe("manual");
  });
});

describe("resolveTimezoneForSave", () => {
  test("uses the browser timezone in automatic mode", () => {
    expect(
      resolveTimezoneForSave({
        mode: "automatic",
        selectedZone: "Asia/Jakarta",
        browserZone: "Asia/Makassar",
      }),
    ).toBe("Asia/Makassar");
  });

  test("uses the selected timezone in manual mode", () => {
    expect(
      resolveTimezoneForSave({
        mode: "manual",
        selectedZone: "Asia/Jakarta",
        browserZone: "Asia/Makassar",
      }),
    ).toBe("Asia/Jakarta");
  });
});
