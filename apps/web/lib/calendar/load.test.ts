import { describe, expect, test } from "bun:test";

import { loadCalendarMonth, type CalendarPageFetcher } from "./load";

const TIMEZONE = "Asia/Makassar";

function okFetcher(
  pages: Array<{ tasks: unknown[]; nextCursor: string | null }>,
): CalendarPageFetcher {
  let call = 0;
  return async () => {
    const page = pages[Math.min(call, pages.length - 1)];
    call += 1;
    return {
      data: { tasks: page.tasks, page: { nextCursor: page.nextCursor } },
      response: { ok: true, status: 200 },
    };
  };
}

function statusFetcher(status: number): CalendarPageFetcher {
  return async () => ({
    data: { error: { code: "ERR", message: "upstream" } },
    response: { ok: false, status },
  });
}

const TASK = {
  id: "t1",
  title: "Submit",
  deadline: "2026-09-15T00:00:00.000Z",
  status: "todo",
  courseName: null,
  courseColor: null,
} as const;

describe("loadCalendarMonth", () => {
  test("returns tasks on a single page", async () => {
    const result = await loadCalendarMonth(
      okFetcher([{ tasks: [TASK], nextCursor: null }]),
      TIMEZONE,
      2026,
      9,
    );
    expect(result.tasks).toEqual([TASK]);
  });

  test("follows cursors across pages", async () => {
    const result = await loadCalendarMonth(
      okFetcher([
        { tasks: [TASK], nextCursor: "cursor-1" },
        { tasks: [{ ...TASK, id: "t2" }], nextCursor: null },
      ]),
      TIMEZONE,
      2026,
      9,
    );
    expect(result.tasks?.map((t) => t.id)).toEqual(["t1", "t2"]);
  });

  test("maps 401 to an auth error (not an API-down message)", async () => {
    const result = await loadCalendarMonth(
      statusFetcher(401),
      TIMEZONE,
      2026,
      9,
    );
    expect(result.errorKind).toBe("auth");
    expect(result.error).toContain("sign in");
    expect(result.error).not.toContain("Ensure the API is running");
  });

  test("maps 403 to a permission error", async () => {
    const result = await loadCalendarMonth(
      statusFetcher(403),
      TIMEZONE,
      2026,
      9,
    );
    expect(result.errorKind).toBe("forbidden");
    expect(result.error).toContain("permission");
  });

  test("maps 400 to a validation error", async () => {
    const result = await loadCalendarMonth(
      statusFetcher(400),
      TIMEZONE,
      2026,
      9,
    );
    expect(result.errorKind).toBe("validation");
  });

  test("maps 500 to a retryable failure without claiming the API is down", async () => {
    const result = await loadCalendarMonth(
      statusFetcher(500),
      TIMEZONE,
      2026,
      9,
    );
    expect(result.errorKind).toBe("failed");
    expect(result.error).not.toContain("Ensure the API is running");
  });

  test("maps transport throws to unreachable (the only API-down case)", async () => {
    const result = await loadCalendarMonth(
      async () => {
        throw new Error("fetch failed");
      },
      TIMEZONE,
      2026,
      9,
    );
    expect(result.errorKind).toBe("unreachable");
    expect(result.error?.toLowerCase()).toContain("ensure the api is running");
  });

  test("rejects a 200 without a task array", async () => {
    const result = await loadCalendarMonth(
      async () => ({
        data: {},
        response: { ok: true, status: 200 },
      }),
      TIMEZONE,
      2026,
      9,
    );
    expect(result.errorKind).toBe("failed");
  });
});
