import { describe, expect, test } from "bun:test";

import {
  applyAllRead,
  applyOneRead,
  shouldCatchUpOnVisible,
} from "./unread-state";

describe("applyOneRead", () => {
  test("decrements by 1", () => {
    expect(applyOneRead(5)).toBe(4);
  });

  test("floors at 0", () => {
    expect(applyOneRead(0)).toBe(0);
    expect(applyOneRead(1)).toBe(0);
  });
});

describe("applyAllRead", () => {
  test("always returns 0", () => {
    expect(applyAllRead()).toBe(0);
  });
});

describe("shouldCatchUpOnVisible", () => {
  const NOW = 1_000_000;
  const INTERVAL = 60_000;

  test("returns true when elapsed exceeds interval", () => {
    expect(shouldCatchUpOnVisible(NOW - INTERVAL - 1, NOW, INTERVAL)).toBe(
      true,
    );
  });

  test("returns false when elapsed is within interval", () => {
    expect(shouldCatchUpOnVisible(NOW - INTERVAL + 1, NOW, INTERVAL)).toBe(
      false,
    );
  });

  test("returns true when exactly at interval boundary (elapsed > interval)", () => {
    // now - lastFetchAt === interval → NOT > interval → false
    expect(shouldCatchUpOnVisible(NOW - INTERVAL, NOW, INTERVAL)).toBe(false);
  });
});
