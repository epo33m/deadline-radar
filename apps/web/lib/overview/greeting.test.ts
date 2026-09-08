import { describe, expect, test } from "bun:test";

import { getOverviewGreeting, getOverviewTagline } from "./greeting";

describe("getOverviewGreeting", () => {
  test("returns hello", () => {
    expect(getOverviewGreeting()).toBe("Hello");
  });
});

describe("getOverviewTagline", () => {
  test("returns apple-style tagline", () => {
    expect(getOverviewTagline()).toBe("See what's due next.");
  });
});
