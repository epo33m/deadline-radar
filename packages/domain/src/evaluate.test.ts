import { describe, expect, test } from "bun:test";

import {
  evaluateReminders,
  isThresholdDue,
  type ReminderTaskInput,
} from "./evaluate";

describe("isThresholdDue", () => {
  // Deadline: Friday 2026-09-11 23:59 Asia/Makassar (UTC+8) = 15:59 UTC
  const deadline = "2026-09-11T15:59:00.000Z";
  const timeZone = "Asia/Makassar";

  test("H-3 is not due before Tuesday 23:59 Makassar", () => {
    const now = new Date("2026-09-08T15:58:59.000Z"); // Tue 23:58:59 Makassar
    expect(isThresholdDue(deadline, 3, now, timeZone)).toBe(false);
  });

  test("H-3 is due at Tuesday 23:59 Makassar", () => {
    const now = new Date("2026-09-08T15:59:00.000Z"); // Tue 23:59 Makassar
    expect(isThresholdDue(deadline, 3, now, timeZone)).toBe(true);
  });

  test("H-0 is due at the deadline instant", () => {
    expect(isThresholdDue(deadline, 0, new Date(deadline), timeZone)).toBe(
      true,
    );
  });

  test("H-7 is already due when now is past the deadline", () => {
    const now = new Date("2026-09-12T00:00:00.000Z");
    expect(isThresholdDue(deadline, 7, now, timeZone)).toBe(true);
  });
});

describe("evaluateReminders", () => {
  const timeZone = "Asia/Makassar";
  // Created when only H-1 and H-0 are still ahead; H-7/H-3 already past.
  const createdAt = "2026-09-09T08:00:00.000Z";
  const deadline = "2026-09-11T15:59:00.000Z";
  const nowAtH1 = new Date("2026-09-10T15:59:00.000Z");

  function baseTask(
    overrides: Partial<ReminderTaskInput> = {},
  ): ReminderTaskInput {
    return {
      id: "task-1",
      status: "todo",
      deadline,
      created_at: createdAt,
      timeZone,
      thresholds: [
        { id: "th-7", days_before: 7 },
        { id: "th-3", days_before: 3 },
        { id: "th-1", days_before: 1 },
        { id: "th-0", days_before: 0 },
      ],
      deliveries: [],
      ...overrides,
    };
  }

  test("skips done tasks entirely", () => {
    const actions = evaluateReminders(
      [baseTask({ status: "done" })],
      nowAtH1,
    );
    expect(actions).toEqual([]);
  });

  test("does not create deliveries for thresholds already past at task creation", () => {
    const actions = evaluateReminders([baseTask()], nowAtH1);
    const thresholdIds = actions.map((a) => a.threshold_id);
    expect(thresholdIds).not.toContain("th-7");
    expect(thresholdIds).not.toContain("th-3");
  });

  test("creates email and in_app deliveries for a newly due threshold", () => {
    const actions = evaluateReminders([baseTask()], nowAtH1);
    expect(actions).toEqual([
      {
        action: "create",
        task_id: "task-1",
        threshold_id: "th-1",
        channel: "email",
        days_before: 1,
      },
      {
        action: "create",
        task_id: "task-1",
        threshold_id: "th-1",
        channel: "in_app",
        days_before: 1,
      },
    ]);
  });

  test("does not create when pending or sent delivery already exists for a channel", () => {
    const actions = evaluateReminders(
      [
        baseTask({
          deliveries: [
            {
              id: "del-email",
              threshold_id: "th-1",
              channel: "email",
              status: "pending",
              retry_count: 0,
            },
            {
              id: "del-inapp",
              threshold_id: "th-1",
              channel: "in_app",
              status: "sent",
              retry_count: 0,
            },
          ],
        }),
      ],
      nowAtH1,
    );
    expect(actions).toEqual([]);
  });

  test("retries a failed email by updating the existing delivery, not creating a duplicate", () => {
    const actions = evaluateReminders(
      [
        baseTask({
          deliveries: [
            {
              id: "del-email-failed",
              threshold_id: "th-1",
              channel: "email",
              status: "failed",
              retry_count: 1,
            },
            {
              id: "del-inapp",
              threshold_id: "th-1",
              channel: "in_app",
              status: "sent",
              retry_count: 0,
            },
          ],
        }),
      ],
      nowAtH1,
    );
    expect(actions).toEqual([
      {
        action: "retry",
        delivery_id: "del-email-failed",
        task_id: "task-1",
        threshold_id: "th-1",
        channel: "email",
        days_before: 1,
        retry_count: 1,
      },
    ]);
    expect(actions.every((a) => a.action !== "create")).toBe(true);
  });

  test("does not create a second email row when a failed delivery already exists", () => {
    const actions = evaluateReminders(
      [
        baseTask({
          deliveries: [
            {
              id: "del-email-failed",
              threshold_id: "th-1",
              channel: "email",
              status: "failed",
              retry_count: 0,
            },
          ],
        }),
      ],
      nowAtH1,
    );
    const emailCreates = actions.filter(
      (a) => a.action === "create" && a.channel === "email",
    );
    const emailRetries = actions.filter(
      (a) => a.action === "retry" && a.channel === "email",
    );
    expect(emailCreates).toHaveLength(0);
    expect(emailRetries).toHaveLength(1);
    expect(emailRetries[0]).toMatchObject({
      delivery_id: "del-email-failed",
    });
  });
});
