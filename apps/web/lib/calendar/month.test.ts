import { describe, expect, test } from "bun:test";

import {
  buildMonthGrid,
  formatDayLabel,
  formatMonthParam,
  formatMonthShortName,
  truncateTitle,
  getZonedDayKey,
  groupTasksByDay,
  monthVisibleRange,
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

describe("monthVisibleRange", () => {
  test("covers the full grid in UTC", () => {
    // Sep 2026 starts on a Tuesday: grid runs Sun 2026-08-30 → Sat 2026-10-03.
    const { dueFrom, dueTo } = monthVisibleRange(2026, 9, "UTC");
    expect(dueFrom).toBe("2026-08-30T00:00:00.000Z");
    expect(dueTo).toBe("2026-10-04T00:00:00.000Z");
  });

  test("shifts with the viewer timezone", () => {
    const utc = monthVisibleRange(2026, 9, "UTC");
    const jakarta = monthVisibleRange(2026, 9, "Asia/Jakarta");
    // UTC+7 midnight local = previous evening UTC.
    expect(jakarta.dueFrom).toBe("2026-08-29T17:00:00.000Z");
    expect(jakarta.dueTo).toBe("2026-10-03T17:00:00.000Z");
    expect(new Date(jakarta.dueFrom).getTime()).toBeLessThan(
      new Date(utc.dueFrom).getTime(),
    );
  });

  test("every grid cell's local midday falls inside [dueFrom, dueTo)", () => {
    for (const tz of ["UTC", "Asia/Jakarta", "America/New_York"]) {
      const cells = buildMonthGrid(2026, 9, tz);
      const { dueFrom, dueTo } = monthVisibleRange(2026, 9, tz);
      const from = new Date(dueFrom).getTime();
      const to = new Date(dueTo).getTime();
      expect(to).toBeGreaterThan(from);
      for (const cell of cells) {
        // Resolve an instant on the cell's zoned day: start at UTC noon of
        // the key, then shift whole days until the zoned key matches.
        let ms = Date.parse(`${cell.dayKey}T12:00:00Z`);
        for (let i = 0; i < 3; i += 1) {
          const key = getZonedDayKey(new Date(ms).toISOString(), tz);
          if (key === cell.dayKey) break;
          const want = Date.parse(`${cell.dayKey}T00:00:00Z`);
          const have = Date.parse(`${key!.slice(0, 10)}T00:00:00Z`);
          ms += Math.round((want - have) / 86_400_000) * 86_400_000;
        }
        expect(getZonedDayKey(new Date(ms).toISOString(), tz)).toBe(
          cell.dayKey,
        );
        expect(ms).toBeGreaterThanOrEqual(from);
        expect(ms).toBeLessThan(to);
      }
    }
  });
});
