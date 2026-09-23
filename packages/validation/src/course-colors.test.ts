import { describe, expect, test } from "bun:test";

import {
  COURSE_COLOR_GROUPS,
  findCourseColorOption,
  getCourseColorFill,
  getCourseColorKind,
  getCourseColorLabel,
  isSystemCourseColor,
  normalizeCourseColorForStorage,
  SYSTEM_COLOR_TOKENS,
} from "./course-colors";

describe("canonical course color system", () => {
  test("exposes 12 system tokens with light display values", () => {
    expect(SYSTEM_COLOR_TOKENS).toHaveLength(12);
    expect(COURSE_COLOR_GROUPS[0]?.options).toHaveLength(12);
    expect(findCourseColorOption("#ff8d28")?.token).toBe("system-orange");
    expect(findCourseColorOption("#00c8b3")?.token).toBe("system-mint");
    expect(findCourseColorOption("#00c3d0")?.token).toBe("system-teal");
    expect(findCourseColorOption("#00c0e8")?.token).toBe("system-cyan");
    expect(findCourseColorOption("#0088ff")?.token).toBe("system-blue");
    expect(findCourseColorOption("#6155f5")?.token).toBe("system-indigo");
    expect(findCourseColorOption("#cb30e0")?.token).toBe("system-purple");
    expect(findCourseColorOption("#ac7f5e")?.token).toBe("system-brown");
  });

  test("classifies system, custom, and none", () => {
    expect(getCourseColorKind("#ff383c")).toBe("system");
    expect(getCourseColorKind("#ff453a")).toBe("system");
    expect(getCourseColorKind("#123456")).toBe("custom");
    expect(getCourseColorKind(null)).toBe("none");
    expect(isSystemCourseColor("#34c759")).toBe(true);
    expect(isSystemCourseColor("#123456")).toBe(false);
  });

  test("labels custom colors as Custom", () => {
    expect(getCourseColorLabel("#ff2d55")).toBe("Pink");
    expect(getCourseColorLabel("#123456")).toBe("Custom");
    expect(getCourseColorLabel("")).toBe("None");
  });

  test("fills and storage preserve custom hex", () => {
    expect(getCourseColorFill("#ff9f0a")).toBe("#ff8d28");
    expect(getCourseColorFill("#123456")).toBe("#123456");
    expect(normalizeCourseColorForStorage("#123456")).toBe("#123456");
    expect(normalizeCourseColorForStorage("")).toBe("");
  });
});
