import { describe, expect, test } from "bun:test";

import {
  groupCourseTasks,
  formatCourseDetailSummaryLine,
  type CourseTask,
} from "./course-tasks";

const NOW = new Date("2026-09-15T12:00:00.000Z");

function task(
  overrides: Partial<CourseTask> &
    Pick<CourseTask, "id" | "title" | "deadline" | "status">,
): CourseTask {
  return { ...overrides };
}

describe("groupCourseTasks", () => {
  test("groups into late, upcoming, and done", () => {
    const groups = groupCourseTasks(
      [
        task({
          id: "late",
          title: "Late",
          deadline: "2026-09-10T12:00:00.000Z",
          status: "todo",
        }),
        task({
          id: "soon",
          title: "Soon",
          deadline: "2026-09-20T12:00:00.000Z",
          status: "in_progress",
        }),
        task({
          id: "done",
          title: "Done",
          deadline: "2026-09-01T12:00:00.000Z",
          status: "done",
        }),
        task({
          id: "undated",
          title: "Undated",
          deadline: "not-a-date",
          status: "todo",
        }),
      ],
      NOW,
    );

    expect(groups.late.map((t) => t.id)).toEqual(["late"]);
    expect(groups.upcoming.map((t) => t.id)).toEqual(["soon", "undated"]);
    expect(groups.done.map((t) => t.id)).toEqual(["done"]);
  });
});

describe("formatCourseDetailSummaryLine", () => {
  test("returns null for empty courses", () => {
    expect(
      formatCourseDetailSummaryLine({
        total: 0,
        late: 0,
        upcoming: 0,
        done: 0,
      }),
    ).toBeNull();
  });

  test("formats total, upcoming, and done", () => {
    expect(
      formatCourseDetailSummaryLine({
        total: 12,
        late: 0,
        upcoming: 3,
        done: 2,
      }),
    ).toBe("12 Tasks · 3 Upcoming · 2 Done");
  });

  test("includes late when present", () => {
    expect(
      formatCourseDetailSummaryLine({
        total: 7,
        late: 2,
        upcoming: 3,
        done: 2,
      }),
    ).toBe("7 Tasks · 2 Late · 3 Upcoming · 2 Done");
  });
});
