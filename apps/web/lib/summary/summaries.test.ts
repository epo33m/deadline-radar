import { describe, expect, test } from "bun:test";

import {
  APPROACHING_WINDOW_DAYS,
  categorizeSummaryTasks,
  type SummaryTask,
} from "./summaries";

const NOW = new Date("2026-09-15T12:00:00.000Z");

function task(
  overrides: Partial<SummaryTask> & Pick<SummaryTask, "id" | "title" | "deadline" | "status">,
): SummaryTask {
  return {
    updated_at: "2026-09-14T12:00:00.000Z",
    ...overrides,
  };
}

describe("categorizeSummaryTasks", () => {
  test("puts active tasks past deadline in overdue and all", () => {
    const summaries = categorizeSummaryTasks(
      [
        task({
          id: "1",
          title: "Late essay",
          deadline: "2026-09-14T23:59:00.000Z",
          status: "todo",
        }),
      ],
      NOW,
    );

    expect(summaries.overdue.map((t) => t.id)).toEqual(["1"]);
    expect(summaries.all.map((t) => t.id)).toEqual(["1"]);
    expect(summaries.approaching).toHaveLength(0);
    expect(summaries.recentlyCompleted).toHaveLength(0);
  });

  test("puts active tasks within the approaching window in approaching and all", () => {
    const withinWindow = new Date(NOW);
    withinWindow.setUTCDate(withinWindow.getUTCDate() + APPROACHING_WINDOW_DAYS);

    const summaries = categorizeSummaryTasks(
      [
        task({
          id: "2",
          title: "Due soon",
          deadline: withinWindow.toISOString(),
          status: "in_progress",
        }),
      ],
      NOW,
    );

    expect(summaries.approaching.map((t) => t.id)).toEqual(["2"]);
    expect(summaries.all.map((t) => t.id)).toEqual(["2"]);
    expect(summaries.overdue).toHaveLength(0);
  });

  test("excludes active tasks beyond the approaching window from approaching but includes them in all", () => {
    const beyondWindow = new Date(NOW);
    beyondWindow.setUTCDate(
      beyondWindow.getUTCDate() + APPROACHING_WINDOW_DAYS + 1,
    );

    const summaries = categorizeSummaryTasks(
      [
        task({
          id: "3",
          title: "Far away",
          deadline: beyondWindow.toISOString(),
          status: "todo",
        }),
      ],
      NOW,
    );

    expect(summaries.approaching).toHaveLength(0);
    expect(summaries.overdue).toHaveLength(0);
    expect(summaries.all.map((t) => t.id)).toEqual(["3"]);
  });

  test("puts recently completed tasks in recentlyCompleted but not all", () => {
    const summaries = categorizeSummaryTasks(
      [
        task({
          id: "4",
          title: "Finished lab",
          deadline: "2026-09-20T23:59:00.000Z",
          status: "done",
          updated_at: "2026-09-14T18:00:00.000Z",
        }),
      ],
      NOW,
    );

    expect(summaries.recentlyCompleted.map((t) => t.id)).toEqual(["4"]);
    expect(summaries.all).toHaveLength(0);
    expect(summaries.approaching).toHaveLength(0);
    expect(summaries.overdue).toHaveLength(0);
  });

  test("excludes done tasks completed outside the recent window", () => {
    const summaries = categorizeSummaryTasks(
      [
        task({
          id: "5",
          title: "Old completion",
          deadline: "2026-08-01T23:59:00.000Z",
          status: "done",
          updated_at: "2026-08-20T12:00:00.000Z",
        }),
      ],
      NOW,
    );

    expect(summaries.recentlyCompleted).toHaveLength(0);
    expect(summaries.all).toHaveLength(0);
  });

  test("does not put done tasks in overdue even when deadline passed", () => {
    const summaries = categorizeSummaryTasks(
      [
        task({
          id: "6",
          title: "Done late",
          deadline: "2026-09-01T23:59:00.000Z",
          status: "done",
          updated_at: "2026-09-10T12:00:00.000Z",
        }),
      ],
      NOW,
    );

    expect(summaries.overdue).toHaveLength(0);
    expect(summaries.all).toHaveLength(0);
    expect(summaries.recentlyCompleted.map((t) => t.id)).toEqual(["6"]);
  });

  test("sorts approaching and all by soonest deadline first", () => {
    const summaries = categorizeSummaryTasks(
      [
        task({
          id: "b",
          title: "Later",
          deadline: "2026-09-20T12:00:00.000Z",
          status: "todo",
        }),
        task({
          id: "a",
          title: "Sooner",
          deadline: "2026-09-16T12:00:00.000Z",
          status: "todo",
        }),
      ],
      NOW,
    );

    expect(summaries.approaching.map((t) => t.id)).toEqual(["a", "b"]);
    expect(summaries.all.map((t) => t.id)).toEqual(["a", "b"]);
  });
});
