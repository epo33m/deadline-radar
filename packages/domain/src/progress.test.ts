import { describe, expect, test } from "bun:test";

import { summarizeProgress, type ProgressTask } from "./progress";

function task(overrides: Partial<ProgressTask> = {}): ProgressTask {
  return {
    status: "todo",
    deadline: "2026-09-20T00:00:00.000Z",
    completedAt: null,
    courseName: "Math",
    courseColor: "#0088ff",
    ...overrides,
  };
}

describe("summarizeProgress", () => {
  test("empty input yields zeros", () => {
    expect(summarizeProgress([])).toEqual({
      completed: 0,
      total: 0,
      onTime: 0,
      onTimeTotal: 0,
      courses: [],
    });
  });

  test("counts completed/total and on-time by completedAt <= deadline", () => {
    const result = summarizeProgress([
      task({
        status: "done",
        deadline: "2026-09-20T00:00:00.000Z",
        completedAt: "2026-09-18T00:00:00.000Z",
      }),
      task({
        status: "done",
        deadline: "2026-09-20T00:00:00.000Z",
        completedAt: "2026-09-20T00:00:00.000Z",
      }),
      task({
        status: "done",
        deadline: "2026-09-20T00:00:00.000Z",
        completedAt: "2026-09-21T00:00:00.000Z",
      }),
      task({ status: "todo", courseName: "Math" }),
    ]);

    expect(result.completed).toBe(3);
    expect(result.total).toBe(4);
    expect(result.onTime).toBe(2);
    expect(result.onTimeTotal).toBe(3);
  });

  test("done tasks never count toward courses; missing course falls back", () => {
    const result = summarizeProgress([
      task({ status: "done", courseName: "Math" }),
      task({ status: "todo", courseName: "Physics", courseColor: "#34c759" }),
      task({ status: "todo", courseName: "Physics", courseColor: "#34c759" }),
      task({ status: "todo", courseName: null, courseColor: null }),
    ]);

    expect(result.courses).toEqual([
      { name: "Physics", color: "#34c759", tasks: 2 },
      { name: "Uncategorized", color: null, tasks: 1 },
    ]);
  });

  test("done without completedAt is completed but never on-time", () => {
    const result = summarizeProgress([
      task({ status: "done", completedAt: null }),
    ]);

    expect(result.completed).toBe(1);
    expect(result.onTime).toBe(0);
    expect(result.onTimeTotal).toBe(1);
    expect(result.courses).toEqual([]);
  });

  test("unparseable dates never count as on-time", () => {
    const result = summarizeProgress([
      task({ status: "done", completedAt: "not-a-date" }),
      task({
        status: "done",
        deadline: "not-a-date",
        completedAt: "2026-09-18T00:00:00.000Z",
      }),
    ]);

    expect(result.completed).toBe(2);
    expect(result.onTime).toBe(0);
  });
});
