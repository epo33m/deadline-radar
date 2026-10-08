import { describe, expect, test } from "bun:test";

import { LIST_MAX_PAGES } from "./limit";
import { parsePageCount } from "./page-count";

/**
 * `?pages=N` arrives straight from the URL, so every branch here is reachable
 * by a crafted link. None of them may throw, and none may widen the walk past
 * `LIST_MAX_PAGES`.
 */
describe("#141 — parsePageCount", () => {
  test("defaults to a single page", () => {
    expect(parsePageCount(undefined)).toBe(1);
    expect(parsePageCount("")).toBe(1);
    expect(parsePageCount("   ")).toBe(1);
    expect(parsePageCount([])).toBe(1);
  });

  test("accepts a positive integer", () => {
    expect(parsePageCount("2")).toBe(2);
    expect(parsePageCount("7")).toBe(7);
    expect(parsePageCount(["3", "9"])).toBe(3);
  });

  test("refuses nonsense instead of throwing", () => {
    expect(parsePageCount("abc")).toBe(1);
    expect(parsePageCount("1.5")).toBe(1);
    expect(parsePageCount("0")).toBe(1);
    expect(parsePageCount("-4")).toBe(1);
    // Scientific/hex notation would otherwise ask for a walk nobody navigated to.
    expect(parsePageCount("1e3")).toBe(1);
    expect(parsePageCount("0x10")).toBe(1);
    expect(parsePageCount("2 pages")).toBe(1);
  });

  test("refuses a value beyond exact integer arithmetic", () => {
    expect(parsePageCount("9".repeat(30))).toBe(1);
  });

  test("clamps a hostile page count to the cap", () => {
    // Without the clamp, `?pages=1000000` turns one link into a cursor walk
    // that hammers the API.
    expect(parsePageCount("999999")).toBe(LIST_MAX_PAGES);
  });

  test("honours an explicit cap", () => {
    expect(parsePageCount("9", 4)).toBe(4);
  });
});
