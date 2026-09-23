import { describe, expect, test } from "bun:test";

import { notificationIsLate, serializeNotification } from "./serialize";

const base = {
  id: "11111111-1111-4111-8111-111111111111",
  taskId: "22222222-2222-4222-8222-222222222222",
  thresholdId: "33333333-3333-4333-8333-333333333333",
  channel: "in_app",
  status: "sent",
  retryCount: 0,
  sentAt: null,
  readAt: null,
  createdAt: "2026-09-01T00:00:00.000Z",
  taskTitle: "Task",
  daysBefore: 1,
};

// Deadline Fri 2026-09-11 23:59 Asia/Makassar = 15:59 UTC; the H-1 trigger
// keeps the local time of day: Thu 2026-09-10 15:59 UTC.
const deadlineIso = "2026-09-11T15:59:00.000Z";
const timeZone = "Asia/Makassar";

describe("RF-11 — notificationIsLate (derive-on-read lateness)", () => {
  test("sent within 1h of the trigger is not late", () => {
    expect(
      notificationIsLate({
        ...base,
        sentAt: "2026-09-10T16:29:00.000Z",
        taskDeadline: deadlineIso,
        timeZone,
      }),
    ).toBe(false);
  });

  test("sent at least 1h after the trigger is late", () => {
    expect(
      notificationIsLate({
        ...base,
        sentAt: "2026-09-10T16:59:00.000Z",
        taskDeadline: deadlineIso,
        timeZone,
      }),
    ).toBe(true);
  });

  test("missing deadline/timezone/sentAt inputs are never late", () => {
    expect(notificationIsLate(base)).toBe(false);
    expect(
      notificationIsLate({ ...base, sentAt: null, taskDeadline: deadlineIso, timeZone }),
    ).toBe(false);
  });

  test("serializeNotification exposes isLate", () => {
    const out = serializeNotification({
      ...base,
      sentAt: new Date("2026-09-10T16:59:00.000Z"),
      taskDeadline: deadlineIso,
      timeZone,
    });
    expect(out.isLate).toBe(true);
  });
});