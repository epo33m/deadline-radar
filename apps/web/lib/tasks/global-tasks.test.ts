import { describe, expect, test } from "bun:test";

import {
  filterTasksByStatusView,
  groupTasksByHorizon,
  resolveTasksEmptyState,
  type GlobalTask,
} from "./global-tasks";

const NOW = new Date("2026-09-15T12:00:00.000Z");
const TZ = "UTC";

function task(
  overrides: Partial<GlobalTask> &
    Pick<GlobalTask, "id" | "title" | "deadline" | "status">,
): GlobalTask {
  return { ...overrides };
}

describe("filterTasksByStatusView", () => {
  const sample = [
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
  ];

  test("all returns every task sorted by deadline with undated last", () => {
    expect(
      filterTasksByStatusView(sample, "all", NOW).map((t) => t.id),
    ).toEqual(["done", "late", "soon", "undated"]);
  });

  test("late returns open tasks past their deadline", () => {
    expect(
      filterTasksByStatusView(sample, "late", NOW).map((t) => t.id),
    ).toEqual(["late"]);
  });

  test("upcoming returns open tasks not yet due, undated last", () => {
    expect(
      filterTasksByStatusView(sample, "upcoming", NOW).map((t) => t.id),
    ).toEqual(["soon", "undated"]);
  });

  test("done returns completed tasks sorted by deadline", () => {
    expect(
      filterTasksByStatusView(sample, "done", NOW).map((t) => t.id),
    ).toEqual(["done"]);
  });
});

describe("groupTasksByHorizon", () => {
  test("splits open tasks into today, upcoming (≤7 days), and later", () => {
    const groups = groupTasksByHorizon(
      [
        task({
          id: "today",
          title: "Today",
          deadline: "2026-09-15T18:00:00.000Z",
          status: "todo",
        }),
        task({
          id: "soon",
          title: "Soon",
          deadline: "2026-09-18T12:00:00.000Z",
          status: "in_progress",
        }),
        task({
          id: "week",
          title: "Week edge",
          deadline: "2026-09-22T12:00:00.000Z",
          status: "todo",
        }),
        task({
          id: "later",
          title: "Later",
          deadline: "2026-09-23T12:00:00.000Z",
          status: "todo",
        }),
        task({
          id: "undated",
          title: "Undated",
          deadline: "not-a-date",
          status: "todo",
        }),
        task({
          id: "done",
          title: "Done",
          deadline: "2026-09-15T08:00:00.000Z",
          status: "done",
        }),
      ],
      TZ,
      NOW,
    );

    expect(groups.today.map((t) => t.id)).toEqual(["today"]);
    expect(groups.upcoming.map((t) => t.id)).toEqual(["soon", "week"]);
    expect(groups.later.map((t) => t.id)).toEqual(["later", "undated"]);
  });
});

describe("resolveTasksEmptyState", () => {
  test("no courses takes priority", () => {
    expect(
      resolveTasksEmptyState({
        courseCount: 0,
        taskCount: 0,
        filteredCount: 0,
      }),
    ).toBe("no-courses");
  });

  test("no tasks when courses exist but collection is empty", () => {
    expect(
      resolveTasksEmptyState({
        courseCount: 2,
        taskCount: 0,
        filteredCount: 0,
      }),
    ).toBe("no-tasks");
  });

  test("no results when filters hide every task", () => {
    expect(
      resolveTasksEmptyState({
        courseCount: 2,
        taskCount: 5,
        filteredCount: 0,
      }),
    ).toBe("no-results");
  });

  test("ready when filtered tasks remain", () => {
    expect(
      resolveTasksEmptyState({
        courseCount: 2,
        taskCount: 5,
        filteredCount: 3,
      }),
    ).toBe("ready");
  });
});
