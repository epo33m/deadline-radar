import { describe, expect, test } from "bun:test";

import {
  buildMonthGrid,
  formatMonthParam,
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
