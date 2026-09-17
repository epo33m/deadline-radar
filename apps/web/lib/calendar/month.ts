import type { TaskStatus } from "@/lib/validation/task";

export type CalendarTask = {
  id: string;
  title: string;
  deadline: string;
  status: TaskStatus;
  course_name?: string | null;
  course_color?: string | null;
};

export type CalendarCell = {
  dayKey: string;
  day: number;
  inCurrentMonth: boolean;
};

export type CalendarMonth = {
  year: number;
  /** 1–12 */
  month: number;
};

const WEEKDAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;

export { WEEKDAY_LABELS };

function getZonedParts(date: Date, timeZone: string) {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  });
  const parts = Object.fromEntries(
    formatter
      .formatToParts(date)
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, part.value]),
  );
  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    hour: Number(parts.hour),
    minute: Number(parts.minute),
    second: Number(parts.second),
  };
}

function zonedPartsAsUtcMs(date: Date, timeZone: string): number {
  const parts = getZonedParts(date, timeZone);
  return Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour,
    parts.minute,
    parts.second,
  );
}

function fromZonedTime(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  second: number,
  timeZone: string,
): Date {
  const desiredAsUtc = Date.UTC(year, month - 1, day, hour, minute, second);
  let guess = desiredAsUtc;
  for (let i = 0; i < 3; i += 1) {
    const offset = zonedPartsAsUtcMs(new Date(guess), timeZone) - guess;
    guess = desiredAsUtc - offset;
  }
  return new Date(guess);
}

function formatDayKey(year: number, month: number, day: number): string {
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${year}-${pad(month)}-${pad(day)}`;
}

function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/** Map a deadline ISO string to a YYYY-MM-DD key in the given timezone. */
export function getZonedDayKey(iso: string, timeZone: string): string | null {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

export function formatMonthParam({ year, month }: CalendarMonth): string {
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${year}-${pad(month)}`;
}

export function shiftMonth(
  year: number,
  month: number,
  delta: number,
): CalendarMonth {
  const date = new Date(Date.UTC(year, month - 1 + delta, 1));
  return {
    year: date.getUTCFullYear(),
    month: date.getUTCMonth() + 1,
  };
}

export function parseMonthParam(
  raw: string | undefined,
  timeZone: string,
  now: Date = new Date(),
): CalendarMonth {
  if (raw && /^\d{4}-\d{2}$/.test(raw)) {
    const [yearText, monthText] = raw.split("-");
    const year = Number(yearText);
    const month = Number(monthText);
    if (month >= 1 && month <= 12) {
      return { year, month };
    }
  }

  const todayKey = getZonedDayKey(now.toISOString(), timeZone);
  if (!todayKey) {
    return { year: now.getUTCFullYear(), month: now.getUTCMonth() + 1 };
  }

  const [year, month] = todayKey.split("-").map(Number);
  return { year, month };
}

function getWeekdayForDayKey(dayKey: string, timeZone: string): number {
  const [year, month, day] = dayKey.split("-").map(Number);
  const date = fromZonedTime(year, month, day, 12, 0, 0, timeZone);
  const weekday = new Intl.DateTimeFormat("en-US", {
    timeZone,
    weekday: "short",
  })
    .formatToParts(date)
    .find((part) => part.type === "weekday")?.value;

  const index = WEEKDAY_LABELS.indexOf(
    weekday as (typeof WEEKDAY_LABELS)[number],
  );
  return index >= 0 ? index : 0;
}

export function buildMonthGrid(
  year: number,
  month: number,
  timeZone: string,
): CalendarCell[] {
  const monthDays = daysInMonth(year, month);
  const firstDayKey = formatDayKey(year, month, 1);
  const startWeekday = getWeekdayForDayKey(firstDayKey, timeZone);
  const cells: CalendarCell[] = [];

  const previous = shiftMonth(year, month, -1);
  const previousMonthDays = daysInMonth(previous.year, previous.month);
  for (let index = startWeekday - 1; index >= 0; index -= 1) {
    const day = previousMonthDays - index;
    cells.push({
      dayKey: formatDayKey(previous.year, previous.month, day),
      day,
      inCurrentMonth: false,
    });
  }

  for (let day = 1; day <= monthDays; day += 1) {
    cells.push({
      dayKey: formatDayKey(year, month, day),
      day,
      inCurrentMonth: true,
    });
  }

  const next = shiftMonth(year, month, 1);
  let nextDay = 1;
  while (cells.length % 7 !== 0) {
    cells.push({
      dayKey: formatDayKey(next.year, next.month, nextDay),
      day: nextDay,
      inCurrentMonth: false,
    });
    nextDay += 1;
  }

  return cells;
}

export function groupTasksByDay(
  tasks: CalendarTask[],
  timeZone: string,
): Map<string, CalendarTask[]> {
  const grouped = new Map<string, CalendarTask[]>();

  for (const task of tasks) {
    const dayKey = getZonedDayKey(task.deadline, timeZone);
    if (!dayKey) continue;

    const bucket = grouped.get(dayKey);
    if (bucket) {
      bucket.push(task);
    } else {
      grouped.set(dayKey, [task]);
    }
  }

  for (const bucket of grouped.values()) {
    bucket.sort(
      (a, b) => new Date(a.deadline).getTime() - new Date(b.deadline).getTime(),
    );
  }

  return grouped;
}

export function formatMonthHeadingParts(
  { year, month }: CalendarMonth,
  timeZone: string,
): { month: string; year: string } {
  const date = fromZonedTime(year, month, 15, 12, 0, 0, timeZone);
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    month: "long",
    year: "numeric",
  }).formatToParts(date);
  const value = (type: Intl.DateTimeFormatPartTypes): string =>
    parts.find((part) => part.type === type)?.value ?? "";
  return { month: value("month"), year: value("year") };
}

export function formatMonthHeading(
  { year, month }: CalendarMonth,
  timeZone: string,
): string {
  const parts = formatMonthHeadingParts({ year, month }, timeZone);
  return `${parts.month} ${parts.year}`;
}

/**
 * Preview rule for task names in month-grid cells: show the full name up to
 * `maxLength` characters, otherwise the first `maxLength` characters plus
 * an ellipsis (e.g. 10 → "Hello Worl...").
 */
export function truncateTitle(title: string, maxLength = 10): string {
  if (title.length <= maxLength) return title;
  return `${title.slice(0, maxLength)}...`;
}

/**
 * Short month name for a YYYY-MM-DD day key (e.g. "Sep"), or null when the
 * key is malformed. Single source for month-start cell labels.
 */
export function formatMonthShortName(dayKey: string): string | null {
  const month = Number(dayKey.split("-")[1]);
  if (!Number.isInteger(month) || month < 1 || month > 12) return null;
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    timeZone: "UTC",
  }).format(new Date(Date.UTC(2026, month - 1, 1)));
}

/**
 * Day number label for month-grid cells. The 1st of a month includes the
 * short month name as a separator (e.g. "Sep 1"); other days are bare.
 */
export function formatDayLabel(dayKey: string, day: number): string {
  if (day !== 1) return String(day);
  const name = formatMonthShortName(dayKey);
  return name ? `${name} ${day}` : String(day);
}
