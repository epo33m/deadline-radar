import { describe, expect, test } from "bun:test";

import { formatRelativeDeadline } from "./deadline-relative";

const NOW = new Date("2026-09-15T12:00:00.000Z");
const TZ = "UTC";

describe("formatRelativeDeadline", () => {
  test("returns days overdue for past deadlines", () => {
    expect(
      formatRelativeDeadline("2026-09-13T23:59:00.000Z", TZ, NOW),
    ).toBe("2 days overdue");
  });

  test("returns singular overdue copy for one day past", () => {
    expect(
      formatRelativeDeadline("2026-09-14T10:00:00.000Z", TZ, NOW),
    ).toBe("1 day overdue");
  });

  test("returns due today for same calendar day", () => {
    expect(
      formatRelativeDeadline("2026-09-15T23:59:00.000Z", TZ, NOW),
    ).toBe("Due today");
  });

  test("returns in N days for upcoming deadlines", () => {
    expect(
      formatRelativeDeadline("2026-09-17T10:00:00.000Z", TZ, NOW),
    ).toBe("In 2 days");
  });

  test("returns singular upcoming copy for tomorrow", () => {
    expect(
      formatRelativeDeadline("2026-09-16T08:00:00.000Z", TZ, NOW),
    ).toBe("In 1 day");
  });
});
