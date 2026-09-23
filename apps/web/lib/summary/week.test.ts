import { describe, expect, test } from "bun:test";

import { summarizeWeekTasks, type WeekSummary } from "./week";
import type { SummaryTask } from "./summaries";

const NOW = new Date("2026-09-16T12:00:00.000Z");

function task(
  overrides: Partial<SummaryTask> & Pick<SummaryTask, "id" | "deadline" | "status">,
): SummaryTask {
  return {
    title: "Task",
    updated_at: "2026-09-15T12:00:00.000Z",
    ...overrides,
  };
}

describe("summarizeWeekTasks", () => {
  test("counts tasks due today, tomorrow, this week, and next week", () => {
    const summary = summarizeWeekTasks(
      [
        task({ id: "today", deadline: "2026-09-16T09:00:00.000Z", status: "todo" }),
        task({ id: "tomorrow", deadline: "2026-09-17T09:00:00.000Z", status: "todo" }),
        task({ id: "in-3-days", deadline: "2026-09-19T09:00:00.000Z", status: "in_progress" }),
        task({ id: "in-10-days", deadline: "2026-09-26T09:00:00.000Z", status: "todo" }),
      ],
      "UTC",
      NOW,
    );

    expect(summary).toEqual<WeekSummary>({
      today: 1,
      tomorrow: 1,
      thisWeek: 3,
      nextWeek: 1,
      thisMonth: 4,
      missed: 1,
      allTasks: 4,
    });
  });

  test("excludes done tasks", () => {
    const summary = summarizeWeekTasks(
      [
        task({ id: "done-today", deadline: "2026-09-16T09:00:00.000Z", status: "done" }),
        task({ id: "todo-today", deadline: "2026-09-16T09:00:00.000Z", status: "todo" }),
      ],
      "UTC",
      NOW,
    );

    expect(summary.today).toBe(1);
    expect(summary.thisWeek).toBe(1);
    expect(summary.allTasks).toBe(1);
  });

  test("excludes overdue tasks from this week and next week", () => {
    const summary = summarizeWeekTasks(
      [
        task({ id: "overdue", deadline: "2026-09-15T09:00:00.000Z", status: "todo" }),
        task({ id: "today", deadline: "2026-09-16T09:00:00.000Z", status: "todo" }),
      ],
      "UTC",
      NOW,
    );

    expect(summary).toEqual<WeekSummary>({
      today: 1,
      tomorrow: 0,
      thisWeek: 1,
      nextWeek: 0,
      thisMonth: 1,
      missed: 2,
      allTasks: 2,
    });
  });

  test("counts on the day boundary of the 7-day window", () => {
    const summary = summarizeWeekTasks(
      [
        task({ id: "day-7", deadline: "2026-09-23T12:00:00.000Z", status: "todo" }),
        task({ id: "day-8", deadline: "2026-09-24T12:00:00.000Z", status: "todo" }),
      ],
      "UTC",
      NOW,
    );

    expect(summary.thisWeek).toBe(1);
    expect(summary.nextWeek).toBe(1);
  });

  test("counts thisMonth up to 30 days and allTasks regardless of deadline", () => {
    const summary = summarizeWeekTasks(
      [
        task({ id: "day-30", deadline: "2026-10-16T09:00:00.000Z", status: "todo" }),
        task({ id: "day-31", deadline: "2026-10-17T09:00:00.000Z", status: "todo" }),
        task({ id: "no-deadline", deadline: "", status: "in_progress" }),
      ],
      "UTC",
      NOW,
    );

    expect(summary.thisMonth).toBe(1);
    expect(summary.allTasks).toBe(3);
    expect(summary.missed).toBe(0);
  });

  test("counts missed tasks that are past their deadline and not done", () => {
    const summary = summarizeWeekTasks(
      [
        task({ id: "past", deadline: "2026-09-15T09:00:00.000Z", status: "todo" }),
        task({ id: "past-in-progress", deadline: "2026-09-10T09:00:00.000Z", status: "in_progress" }),
        task({ id: "done-past", deadline: "2026-09-14T09:00:00.000Z", status: "done" }),
        task({ id: "future", deadline: "2026-09-17T09:00:00.000Z", status: "todo" }),
      ],
      "UTC",
      NOW,
    );

    expect(summary.missed).toBe(2);
    expect(summary.allTasks).toBe(3);
  });
});