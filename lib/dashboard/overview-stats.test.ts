import { describe, expect, test } from "bun:test";

import { computeOverviewStats, type DashboardTask } from "./overview-stats";

const NOW = new Date("2026-09-15T12:00:00.000Z");

function task(
  overrides: Partial<DashboardTask> & Pick<DashboardTask, "id" | "title" | "deadline" | "status">,
): DashboardTask {
  return {
    updated_at: "2026-09-14T12:00:00.000Z",
    ...overrides,
  };
}

describe("computeOverviewStats", () => {
  test("counts overdue, due this week, completed this week, and total tasks", () => {
    const stats = computeOverviewStats(
      [
        task({
          id: "1",
          title: "Overdue",
          deadline: "2026-09-14T23:59:00.000Z",
          status: "todo",
        }),
        task({
          id: "2",
          title: "Due soon",
          deadline: "2026-09-20T12:00:00.000Z",
          status: "in_progress",
        }),
        task({
          id: "3",
          title: "Done recently",
          deadline: "2026-09-20T23:59:00.000Z",
          status: "done",
          updated_at: "2026-09-14T18:00:00.000Z",
        }),
        task({
          id: "4",
          title: "Far future",
          deadline: "2026-12-01T23:59:00.000Z",
          status: "todo",
        }),
      ],
      NOW,
    );

    expect(stats).toEqual({
      overdue: 1,
      dueThisWeek: 1,
      completedThisWeek: 1,
      totalTasks: 4,
    });
  });
});
