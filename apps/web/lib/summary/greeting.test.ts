import { describe, expect, test } from "bun:test";

import { getSummaryGreeting, getSummaryTagline } from "./greeting";

describe("getSummaryGreeting", () => {
  test("returns hello", () => {
    expect(getSummaryGreeting()).toBe("Hello");
  });
});

describe("getSummaryTagline", () => {
  test("returns apple-style tagline", () => {
    expect(getSummaryTagline()).toBe("See your deadlines at a glance.");
  });
});