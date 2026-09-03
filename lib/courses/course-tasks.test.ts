import { describe, expect, test } from "bun:test";

import {
  orderCourseTasks,
  summarizeCourseTasks,
  type CourseTask,
} from "./course-tasks";

const NOW = new Date("2026-09-15T12:00:00.000Z");

function task(
  overrides: Partial<CourseTask> &
    Pick<CourseTask, "id" | "title" | "deadline" | "status">,
): CourseTask {
  return { ...overrides };
}

describe("orderCourseTasks", () => {
  test("orders overdue before upcoming, then by soonest deadline", () => {
    const ordered = orderCourseTasks(
      [
        task({
          id: "far",
          title: "Far",
          deadline: "2026-09-25T12:00:00.000Z",
          status: "todo",
        }),
        task({
          id: "overdue-later",
          title: "Overdue later",
          deadline: "2026-09-14T12:00:00.000Z",
          status: "todo",
        }),
        task({
          id: "soon",
          title: "Soon",
          deadline: "2026-09-16T12:00:00.000Z",
          status: "in_progress",
        }),
        task({
          id: "overdue-earlier",
          title: "Overdue earlier",
          deadline: "2026-09-10T12:00:00.000Z",
          status: "todo",
        }),
      ],
      NOW,
    );

    expect(ordered.map((t) => t.id)).toEqual([
      "overdue-earlier",
      "overdue-later",
      "soon",
      "far",
    ]);
  });

  test("keeps done tasks after active work", () => {
    const ordered = orderCourseTasks(
      [
        task({
          id: "done",
          title: "Done",
          deadline: "2026-09-01T12:00:00.000Z",
          status: "done",
        }),
        task({
          id: "active",
          title: "Active",
          deadline: "2026-09-20T12:00:00.000Z",
          status: "todo",
        }),
      ],
      NOW,
    );

    expect(ordered.map((t) => t.id)).toEqual(["active", "done"]);
  });

  test("keeps tasks with invalid deadlines after dated active work", () => {
    const ordered = orderCourseTasks(
      [
        task({
          id: "bad",
          title: "Bad",
          deadline: "not-a-date",
          status: "todo",
        }),
        task({
          id: "ok",
          title: "Ok",
          deadline: "2026-09-20T12:00:00.000Z",
          status: "todo",
        }),
        task({
          id: "done",
          title: "Done",
          deadline: "2026-09-01T12:00:00.000Z",
          status: "done",
        }),
      ],
      NOW,
    );

    expect(ordered.map((t) => t.id)).toEqual(["ok", "bad", "done"]);
  });
});

describe("summarizeCourseTasks", () => {
  test("counts overdue, due this week, and completed", () => {
    const summary = summarizeCourseTasks(
      [
        task({
          id: "1",
          title: "Late",
          deadline: "2026-09-14T12:00:00.000Z",
          status: "todo",
        }),
        task({
          id: "2",
          title: "This week",
          deadline: "2026-09-18T12:00:00.000Z",
          status: "in_progress",
        }),
        task({
          id: "3",
          title: "Later",
          deadline: "2026-09-30T12:00:00.000Z",
          status: "todo",
        }),
        task({
          id: "4",
          title: "Finished",
          deadline: "2026-09-20T12:00:00.000Z",
          status: "done",
        }),
      ],
      NOW,
    );

    expect(summary).toEqual({
      overdue: 1,
      dueThisWeek: 1,
      completed: 1,
    });
  });

  test("does not count done tasks as overdue", () => {
    const summary = summarizeCourseTasks(
      [
        task({
          id: "1",
          title: "Done late",
          deadline: "2026-09-01T12:00:00.000Z",
          status: "done",
        }),
      ],
      NOW,
    );

    expect(summary).toEqual({
      overdue: 0,
      dueThisWeek: 0,
      completed: 1,
    });
  });
});
