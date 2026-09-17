import { describe, expect, test } from "bun:test";

import {
  COURSE_CARD_PRESENTATION,
  COURSE_COLOR_GROUPS,
  findCourseColorOption,
  getCourseCardPresentation,
  getCourseColorFill,
  getCourseColorKind,
  getCourseColorLabel,
  NO_COURSE_COLOR,
  normalizeCourseColorForStorage,
  SYSTEM_COLOR_TOKENS,
} from "./colors";

const SYSTEM_LIGHTS: Record<string, string> = {
  "system-red": "#ff383c",
  "system-orange": "#ff8d28",
  "system-yellow": "#ffcc00",
  "system-green": "#34c759",
  "system-mint": "#00c8b3",
  "system-teal": "#00c3d0",
  "system-cyan": "#00c0e8",
  "system-blue": "#0088ff",
  "system-indigo": "#6155f5",
  "system-purple": "#cb30e0",
  "system-pink": "#ff2d55",
  "system-brown": "#ac7f5e",
};

const SYSTEM_DARKS: Record<string, string> = {
  "system-red": "#ff453a",
  "system-orange": "#ff9f0a",
  "system-yellow": "#ffd60a",
  "system-green": "#30d158",
  "system-mint": "#63e6e2",
  "system-teal": "#40c8e0",
  "system-cyan": "#64d2ff",
  "system-blue": "#0a84ff",
  "system-indigo": "#5e5ce6",
  "system-purple": "#bf5af2",
  "system-pink": "#ff375f",
  "system-brown": "#ac8e68",
};

/** Pre-standardization values: migrated by SQL, no longer system. */
const REMOVED_LEGACY = [
  "#ff3b30",
  "#0071e3",
  "#007aff",
  "#ff9500",
  "#00c7be",
  "#30b0c7",
  "#32ade6",
  "#5856d6",
  "#af52de",
  "#a2845e",
];

describe("course colors", () => {
  test("exposes the canonical 12-value system palette", () => {
    expect(SYSTEM_COLOR_TOKENS).toHaveLength(12);
    expect(SYSTEM_COLOR_TOKENS.map((option) => option.appleName)).toEqual([
      "systemRed",
      "systemOrange",
      "systemYellow",
      "systemGreen",
      "systemMint",
      "systemTeal",
      "systemCyan",
      "systemBlue",
      "systemIndigo",
      "systemPurple",
      "systemPink",
      "systemBrown",
    ]);
    for (const option of SYSTEM_COLOR_TOKENS) {
      expect(option.light).toBe(SYSTEM_LIGHTS[option.token]);
      expect(option.dark).toBe(SYSTEM_DARKS[option.token]);
    }
  });

  test("Default group contains system palette only", () => {
    expect(COURSE_COLOR_GROUPS[0]?.label).toBe("Default");
    expect(COURSE_COLOR_GROUPS[0]?.options).toHaveLength(12);
    expect(COURSE_COLOR_GROUPS[0]?.options).not.toContainEqual(NO_COURSE_COLOR);
  });

  test("light and dark values resolve to system tokens", () => {
    expect(findCourseColorOption("#FFCC00")?.appleName).toBe("systemYellow");
    expect(findCourseColorOption("#ffd60a")?.light).toBe("#ffcc00");
    expect(findCourseColorOption("#0088ff")?.token).toBe("system-blue");
    expect(findCourseColorOption("#0a84ff")?.light).toBe("#0088ff");
    expect(findCourseColorOption("#FF453A")?.light).toBe("#ff383c");
    expect(findCourseColorOption("")?.token).toBe("none");
    expect(findCourseColorOption("#123456")).toBeUndefined();
  });

  test("removed legacy values are no longer system", () => {
    for (const legacy of REMOVED_LEGACY) {
      expect(findCourseColorOption(legacy)).toBeUndefined();
      expect(getCourseColorKind(legacy)).toBe("custom");
    }
  });

  test("getCourseColorKind classifies none, system, and custom", () => {
    expect(getCourseColorKind(null)).toBe("none");
    expect(getCourseColorKind("")).toBe("none");
    expect(getCourseColorKind("  ")).toBe("none");
    expect(getCourseColorKind("blue")).toBe("none");
    expect(getCourseColorKind("#ff8d28")).toBe("system");
    expect(getCourseColorKind("#FF9F0A")).toBe("system");
    expect(getCourseColorKind("#123456")).toBe("custom");
    expect(getCourseColorKind("#abcdef")).toBe("custom");
  });

  test("getCourseColorLabel returns system labels or Custom", () => {
    expect(getCourseColorLabel("#6155f5")).toBe("Indigo");
    expect(getCourseColorLabel("")).toBe("None");
    expect(getCourseColorLabel("#123456")).toBe("Custom");
    expect(getCourseColorLabel("#0071e3")).toBe("Custom");
    expect(getCourseColorLabel("blue")).toBe("None");
  });

  test("getCourseColorFill returns light for system, hex for custom", () => {
    expect(getCourseColorFill(null)).toBeNull();
    expect(getCourseColorFill("#ffcc00")).toBe("#ffcc00");
    expect(getCourseColorFill("#ffd60a")).toBe("#ffcc00");
    expect(getCourseColorFill("#0a84ff")).toBe("#0088ff");
    expect(getCourseColorFill("#123456")).toBe("#123456");
    expect(getCourseColorFill("#ABCDEF")).toBe("#abcdef");
    expect(getCourseColorFill("#0071e3")).toBe("#0071e3");
    expect(getCourseColorFill("blue")).toBeNull();
  });

  test("normalizeCourseColorForStorage keeps system light and custom hex", () => {
    expect(normalizeCourseColorForStorage("#FF453A")).toBe("#ff383c");
    expect(normalizeCourseColorForStorage("#abcdef")).toBe("#abcdef");
    expect(normalizeCourseColorForStorage("#0071e3")).toBe("#0071e3");
    expect(normalizeCourseColorForStorage("blue")).toBe("");
    expect(normalizeCourseColorForStorage("")).toBe("");
  });

  test("every system token has a card presentation", () => {
    expect(Object.keys(COURSE_CARD_PRESENTATION).sort()).toEqual(
      Object.keys(SYSTEM_LIGHTS).sort(),
    );
    for (const option of SYSTEM_COLOR_TOKENS) {
      const presentation = getCourseCardPresentation(option.token);
      expect(presentation?.gradient).toContain(option.light.toUpperCase());
      expect(presentation?.gradient).toContain("linear-gradient(120deg");
      expect(presentation?.iconClass.startsWith("text-[")).toBe(true);
    }
    expect(getCourseCardPresentation("system-unknown")).toBeUndefined();
    expect(getCourseCardPresentation(null)).toBeUndefined();
  });
});
