import { describe, expect, test } from "bun:test";

import { deadlineMs, sortTasksAllView } from "./task-sort";

const T = (status: string, deadline: string, id: string) =>
  ({ id, status, deadline }) as { id: string; status: "todo" | "in_progress" | "done"; deadline: string };

describe("sortTasksAllView", () => {
  test("orders todo → in_progress → done, nearest deadline first within a status", () => {
    const input = [
      T("done", "2026-10-01T00:00:00Z", "d1"),
      T("todo", "2026-10-05T00:00:00Z", "t2"),
      T("in_progress", "2026-10-03T00:00:00Z", "p1"),
      T("todo", "2026-10-01T00:00:00Z", "t1"),
    ];
    expect(sortTasksAllView(input).map((t: { id: string }) => t.id)).toEqual([
      "t1",
      "t2",
      "p1",
      "d1",
    ]);
  });

  test("invalid deadlines sort last within their status bucket", () => {
    const input = [
      T("todo", "not-a-date", "bad"),
      T("todo", "2026-10-01T00:00:00Z", "ok"),
    ];
    expect(sortTasksAllView(input).map((t: { id: string }) => t.id)).toEqual(["ok", "bad"]);
  });

  test("does not mutate the input array", () => {
    const input = [T("done", "2026-10-01T00:00:00Z", "d1"), T("todo", "2026-10-01T00:00:00Z", "t1")];
    const copy = [...input];
    sortTasksAllView(input);
    expect(input).toEqual(copy);
  });

  test("deadlineMs maps NaN to +Infinity", () => {
    expect(deadlineMs("garbage")).toBe(Number.POSITIVE_INFINITY);
    expect(deadlineMs("2026-10-01T00:00:00Z")).toBe(
      new Date("2026-10-01T00:00:00Z").getTime(),
    );
  });
});
