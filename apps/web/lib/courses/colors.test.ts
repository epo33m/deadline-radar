import { describe, expect, test } from "bun:test";

import {
  COURSE_COLOR_GROUPS,
  findCourseColorOption,
  getCourseColorFill,
  getCourseColorLabel,
  NO_COURSE_COLOR,
  normalizeCourseColorForStorage,
  SYSTEM_COLOR_TOKENS,
} from "./colors";

describe("course colors", () => {
  test("exposes the full Apple HIG system palette", () => {
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
    expect(findCourseColorOption("#007aff")?.light).toBe("#007aff");
  });

  test("Default group contains HIG palette only", () => {
    expect(COURSE_COLOR_GROUPS[0]?.label).toBe("Default");
    expect(COURSE_COLOR_GROUPS[0]?.options).toHaveLength(12);
    expect(COURSE_COLOR_GROUPS[0]?.options).not.toContainEqual(NO_COURSE_COLOR);
  });

  test("findCourseColorOption resolves light, dark, and legacy values", () => {
    expect(findCourseColorOption("#FFCC00")?.appleName).toBe("systemYellow");
    expect(findCourseColorOption("#ffd60a")?.light).toBe("#ffcc00");
    expect(findCourseColorOption("#0071e3")?.token).toBe("system-blue");
    expect(findCourseColorOption("")?.token).toBe("none");
    expect(findCourseColorOption("#123456")).toBeUndefined();
  });

  test("getCourseColorLabel returns readable labels", () => {
    expect(getCourseColorLabel("#5856d6")).toBe("Indigo");
    expect(getCourseColorLabel("")).toBe("None");
    expect(getCourseColorLabel("#123456")).toBe("None");
  });

  test("getCourseColorFill returns solid light palette colors", () => {
    expect(getCourseColorFill(null)).toBeNull();
    expect(getCourseColorFill("#ffcc00")).toBe("#ffcc00");
    expect(getCourseColorFill("#ffd60a")).toBe("#ffcc00");
    expect(getCourseColorFill("#0071e3")).toBe("#007aff");
    expect(getCourseColorFill("#123456")).toBeNull();
  });

  test("normalizeCourseColorForStorage only keeps palette colors", () => {
    expect(normalizeCourseColorForStorage("#FF453A")).toBe("#ff3b30");
    expect(normalizeCourseColorForStorage("#0071e3")).toBe("#007aff");
    expect(normalizeCourseColorForStorage("#abcdef")).toBe("");
    expect(normalizeCourseColorForStorage("")).toBe("");
  });
});
