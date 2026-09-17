import { describe, expect, test } from "bun:test";

import {
  buildMonthGrid,
  formatDayLabel,
  formatMonthParam,
  formatMonthShortName,
  truncateTitle,
  getZonedDayKey,
  groupTasksByDay,
  parseMonthParam,
  shiftMonth,
  type CalendarTask,
} from "./month";

const TIMEZONE = "Asia/Makassar";

function task(
  overrides: Partial<CalendarTask> & Pick<CalendarTask, "id" | "title" | "deadline">,
): CalendarTask {
  return {
    status: "todo",
    ...overrides,
  };
}

describe("parseMonthParam", () => {
  test("parses a valid YYYY-MM param", () => {
    expect(parseMonthParam("2026-09", TIMEZONE)).toEqual({
      year: 2026,
      month: 9,
    });
  });

  test("falls back to the current month in the timezone", () => {
    const now = new Date("2026-03-15T04:00:00.000Z");
    expect(parseMonthParam(undefined, TIMEZONE, now)).toEqual({
      year: 2026,
      month: 3,
    });
  });
});

describe("shiftMonth", () => {
  test("moves across year boundaries", () => {
    expect(shiftMonth(2026, 1, -1)).toEqual({ year: 2025, month: 12 });
    expect(shiftMonth(2026, 12, 1)).toEqual({ year: 2027, month: 1 });
  });
});

describe("formatMonthParam", () => {
  test("zero-pads the month", () => {
    expect(formatMonthParam({ year: 2026, month: 3 })).toBe("2026-03");
  });
});

describe("getZonedDayKey", () => {
  test("maps a deadline to the local calendar day", () => {
    expect(
      getZonedDayKey("2026-09-01T15:30:00.000Z", TIMEZONE),
    ).toBe("2026-09-01");
  });
});

describe("groupTasksByDay", () => {
  test("groups and sorts tasks by deadline within each day", () => {
    const grouped = groupTasksByDay(
      [
        task({
          id: "b",
          title: "Later",
          deadline: "2026-09-10T10:00:00.000Z",
        }),
        task({
          id: "a",
          title: "Earlier",
          deadline: "2026-09-10T02:00:00.000Z",
        }),
        task({
          id: "c",
          title: "Other day",
          deadline: "2026-09-11T08:00:00.000Z",
        }),
      ],
      TIMEZONE,
    );

    expect(grouped.get("2026-09-10")?.map((entry) => entry.id)).toEqual([
      "a",
      "b",
    ]);
    expect(grouped.get("2026-09-11")?.map((entry) => entry.id)).toEqual(["c"]);
  });
});

describe("buildMonthGrid", () => {
  test("starts the grid on the correct weekday and pads adjacent months", () => {
    const cells = buildMonthGrid(2026, 9, "UTC");
    expect(cells[0]?.dayKey).toBe("2026-08-30");
    expect(cells.find((cell) => cell.dayKey === "2026-09-01")?.inCurrentMonth).toBe(
      true,
    );
    expect(cells.length % 7).toBe(0);
  });
});

describe("formatDayLabel", () => {
  test("prefixes the 1st with the short month name", () => {
    expect(formatDayLabel("2026-09-01", 1)).toBe("Sep 1");
    expect(formatDayLabel("2026-01-01", 1)).toBe("Jan 1");
    expect(formatDayLabel("2026-12-01", 1)).toBe("Dec 1");
  });

  test("returns the bare day otherwise", () => {
    expect(formatDayLabel("2026-09-15", 15)).toBe("15");
    expect(formatDayLabel("2026-09-02", 2)).toBe("2");
  });

  test("falls back to the bare day for a malformed key", () => {
    expect(formatDayLabel("not-a-key", 1)).toBe("1");
  });
});

describe("formatMonthShortName", () => {
  test("returns the short month name for a valid key", () => {
    expect(formatMonthShortName("2026-09-01")).toBe("Sep");
    expect(formatMonthShortName("2026-01-15")).toBe("Jan");
  });

  test("returns null for a malformed key", () => {
    expect(formatMonthShortName("not-a-key")).toBeNull();
    expect(formatMonthShortName("2026-13-01")).toBeNull();
  });
});

describe("truncateTitle", () => {
  test("shows the full name at or under 10 characters", () => {
    expect(truncateTitle("Quiz")).toBe("Quiz");
    expect(truncateTitle("1234567890")).toBe("1234567890");
    expect(truncateTitle("")).toBe("");
  });

  test("truncates longer names with an ellipsis", () => {
    expect(truncateTitle("Hello World")).toBe("Hello Worl...");
  });

  test("respects a custom limit", () => {
    expect(truncateTitle("Hello", 3)).toBe("Hel...");
  });
});
