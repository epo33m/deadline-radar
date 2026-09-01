import { describe, expect, test } from "bun:test";

import { getOverviewGreeting } from "./greeting";

describe("getOverviewGreeting", () => {
  test("returns good morning before noon in the timezone", () => {
    expect(
      getOverviewGreeting(new Date("2026-09-15T08:00:00.000Z"), "UTC"),
    ).toBe("Good morning.");
  });

  test("returns good afternoon between noon and 5pm", () => {
    expect(
      getOverviewGreeting(new Date("2026-09-15T14:00:00.000Z"), "UTC"),
    ).toBe("Good afternoon.");
  });

  test("returns good evening after 5pm", () => {
    expect(
      getOverviewGreeting(new Date("2026-09-15T20:00:00.000Z"), "UTC"),
    ).toBe("Good evening.");
  });
});
