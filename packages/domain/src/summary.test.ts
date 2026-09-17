import { describe, expect, test } from "bun:test";

import {
  summarizeDeadlineBuckets,
  type SummaryBucketTask,
  type WeekSummary,
} from "./summary";

const NOW = new Date("2026-09-16T04:00:00.000Z");
const JAKARTA = "Asia/Jakarta";

function task(
  deadline: string,
  status: string = "todo",
): SummaryBucketTask {
  return { deadline, status };
}

const allZero: WeekSummary = {
  today: 0,
  tomorrow: 0,
  thisWeek: 0,
  nextWeek: 0,
  thisMonth: 0,
  missed: 0,
  allTasks: 0,
};

describe("summarizeDeadlineBuckets", () => {
  test("empty input yields all zeros", () => {
    expect(summarizeDeadlineBuckets([], JAKARTA, NOW)).toEqual(allZero);
  });

  test("maps every day-window boundary correctly (Asia/Jakarta)", () => {
    // Jakarta times (UTC+7): 04:00Z = 11:00 local.
    // today=09-16, tomorrow=09-17, thisWeek=[09-16..09-23], nextWeek=(09-23..09-30], thisMonth=[09-16..10-16]
    const tasks = [
      task("2026-09-15T20:00:00.000Z"), // 03:00 local on 09-16 — past, so today + missed
      task("2026-09-16T06:00:00.000Z"), // 13:00 local — today (after now)
      task("2026-09-16T18:00:00.000Z"), // 01:00 local on 09-17 — tomorrow
      task("2026-09-23T03:59:00.000Z"), // 10:59 local 09-23 — thisWeek end (inclusive)
      task("2026-09-24T00:00:00.000Z"), // 07:00 local 09-24 — nextWeek
      task("2026-09-30T03:59:00.000Z"), // 10:59 local 09-30 — nextWeek end (inclusive)
      task("2026-10-16T03:59:00.000Z"), // 10:59 local 10-16 — thisMonth end (inclusive)
      task("2026-10-17T00:00:00.000Z"), // 07:00 local 10-17 — outside all day buckets
      task("2026-10-16T03:59:00.000Z", "done"), // done → excluded everywhere
      task("not-a-date"), // unparseable → allTasks only
    ];

    expect(summarizeDeadlineBuckets(tasks, JAKARTA, NOW)).toEqual({
      today: 2,
      tomorrow: 1,
      thisWeek: 4,
      nextWeek: 2,
      thisMonth: 7,
      missed: 1,
      allTasks: 9,
    });
  });

  test("thisWeek/nextWeek do not overlap at the shared end key", () => {
    const atWeekEnd = [task("2026-09-23T03:59:00.000Z")];
    const atDayAfter = [task("2026-09-24T00:00:00.000Z")];

    const week = summarizeDeadlineBuckets(atWeekEnd, JAKARTA, NOW);
    expect(week.thisWeek).toBe(1);
    expect(week.nextWeek).toBe(0);

    const after = summarizeDeadlineBuckets(atDayAfter, JAKARTA, NOW);
    expect(after.thisWeek).toBe(0);
    expect(after.nextWeek).toBe(1);
  });

  test("missed tasks stay in their calendar bucket", () => {
    const pastToday = [task("2026-09-15T20:00:00.000Z")];
    const summary = summarizeDeadlineBuckets(pastToday, JAKARTA, NOW);
    expect(summary.missed).toBe(1);
    expect(summary.today).toBe(1);
    expect(summary.thisWeek).toBe(1);
    expect(summary.thisMonth).toBe(1);
  });

  test("done tasks are excluded from every bucket, including allTasks and missed", () => {
    const donePast = [task("2026-09-15T20:00:00.000Z", "done")];
    const doneToday = [task("2026-09-16T02:00:00.000Z", "done")];
    expect(summarizeDeadlineBuckets(donePast, JAKARTA, NOW)).toEqual(allZero);
    expect(summarizeDeadlineBuckets(doneToday, JAKARTA, NOW)).toEqual(allZero);
  });

  test("unparseable deadline only increments allTasks", () => {
    expect(
      summarizeDeadlineBuckets([task("garbage")], JAKARTA, NOW),
    ).toEqual({ ...allZero, allTasks: 1 });
  });

  test("same instant lands on a different calendar day per timezone", () => {
    // 09-16T08:00Z = 09-16 15:00 Jakarta (UTC+7) = 09-16 01:00 Los Angeles (UTC-7).
    // Jakarta's "today" is already 09-16; LA is still on 09-15 at `now`, so the
    // instant is Jakarta-today but LA-tomorrow.
    const crossMidnight = [task("2026-09-16T08:00:00.000Z")];

    const jakarta = summarizeDeadlineBuckets(crossMidnight, JAKARTA, NOW);
    expect(jakarta.today).toBe(1);
    expect(jakarta.tomorrow).toBe(0);

    const la = summarizeDeadlineBuckets(
      crossMidnight,
      "America/Los_Angeles",
      NOW,
    );
    expect(la.today).toBe(0);
    expect(la.tomorrow).toBe(1);
  });

  test("rolling windows stay stable across a DST transition", () => {
    // 2026-11-01 is US DST fall-back (2am EDT → EST). The 14-day window from
    // Mon 2026-10-19 crosses it, but day-key arithmetic must not shift.
    const ny = "America/New_York";
    const dstNow = new Date("2026-10-19T12:00:00.000Z");

    const atWeekEnd = [task("2026-10-26T12:00:00.000Z")]; // exactly +7d
    const atNextWeekEnd = [task("2026-11-02T12:00:00.000Z")]; // exactly +14d (after fall-back)

    const week = summarizeDeadlineBuckets(atWeekEnd, ny, dstNow);
    expect(week.thisWeek).toBe(1);
    expect(week.nextWeek).toBe(0);

    const next = summarizeDeadlineBuckets(atNextWeekEnd, ny, dstNow);
    expect(week.thisWeek).toBe(1);
    expect(next.thisWeek).toBe(0);
    expect(next.nextWeek).toBe(1);
    expect(next.thisMonth).toBe(1);
  });
});