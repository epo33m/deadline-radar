// F-06: systemic-failure alert truth table. Only a total blackout pages;
// partial failures, quota-only runs, and idle runs stay quiet.
import { describe, expect, test } from "bun:test";

import { isSystemicReminderFailure } from "./reminder-alert";

describe("isSystemicReminderFailure", () => {
  test("blackout: attempted sends all failed → alert", () => {
    expect(
      isSystemicReminderFailure({ emailsSent: 0, emailsFailed: 7 }),
    ).toBe(true);
  });

  test("single failure counts as blackout when nothing else sent", () => {
    expect(
      isSystemicReminderFailure({ emailsSent: 0, emailsFailed: 1 }),
    ).toBe(true);
  });

  test("partial failure amid successes stays quiet", () => {
    expect(
      isSystemicReminderFailure({ emailsSent: 12, emailsFailed: 1 }),
    ).toBe(false);
  });

  test("all sent stays quiet", () => {
    expect(
      isSystemicReminderFailure({ emailsSent: 5, emailsFailed: 0 }),
    ).toBe(false);
  });

  test("zero activity (steady state) stays quiet", () => {
    expect(
      isSystemicReminderFailure({ emailsSent: 0, emailsFailed: 0 }),
    ).toBe(false);
  });

  // RF-08: deterministic poison (missing task/recipient) is a data-integrity
  // condition, never a provider outage — a lone orphaned delivery must not page.
  test("poison-only failure stays quiet (no false blackout)", () => {
    expect(
      isSystemicReminderFailure({
        emailsSent: 0,
        emailsFailed: 1,
        emailsPoisoned: 1,
      }),
    ).toBe(false);
  });

  test("poison plus a real provider failure → alert", () => {
    expect(
      isSystemicReminderFailure({
        emailsSent: 0,
        emailsFailed: 3,
        emailsPoisoned: 2,
      }),
    ).toBe(true);
  });

  test("real failure only still alerts", () => {
    expect(
      isSystemicReminderFailure({
        emailsSent: 0,
        emailsFailed: 1,
        emailsPoisoned: 0,
      }),
    ).toBe(true);
  });
});
