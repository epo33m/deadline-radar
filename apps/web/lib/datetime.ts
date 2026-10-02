import type { TimeFormat } from "@deadline-radar/validation";

export type { TimeFormat } from "@deadline-radar/validation";

/**
 * One formatter per (locale, options) — creating `Intl.DateTimeFormat`
 * per call/per row allocates heavily (F-11c). Keyed on the options shape;
 * every call site uses fixed option literals, so the Map stays tiny.
 */
const formatterCache = new Map<string, Intl.DateTimeFormat>();

function getFormatter(
  locale: string,
  options: Intl.DateTimeFormatOptions,
): Intl.DateTimeFormat {
  const key = `${locale}|${JSON.stringify(options)}`;
  let formatter = formatterCache.get(key);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat(locale, options);
    formatterCache.set(key, formatter);
  }
  return formatter;
}

/** Test hook — number of cached formatters (should stay constant per options set). */
export function formatterCacheSize(): number {
  return formatterCache.size;
}

/** Wall-clock parts of an instant in a given IANA timezone. */
function getZonedDateTimeParts(date: Date, timeZone: string) {
  const formatter = getFormatter("en-US", {
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

/** Interpret the zoned wall-clock of `date` as if those digits were UTC. */
function zonedPartsAsUtcMs(date: Date, timeZone: string): number {
  const p = getZonedDateTimeParts(date, timeZone);
  return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
}

/**
 * Convert a wall-clock datetime in `timeZone` to a UTC Date.
 * Iterates to settle DST / offset around the target instant (same algorithm
 * as `thresholdTriggerAt` in `@deadline-radar/domain` and `fromZonedTime`
 * in `lib/calendar/month.ts`).
 */
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

/**
 * Format a timestamptz ISO string for `<input type="datetime-local" />`,
 * interpreting the instant in `timeZone` (the profile timezone). Previously
 * this used browser-local `getHours()`, which diverged from every display
 * call site (they all render in the profile TZ) whenever the two differed
 * (#66).
 */
export function toDatetimeLocalValue(iso: string, timeZone = "UTC"): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  try {
    const p = getZonedDateTimeParts(date, timeZone);
    if (
      !Number.isFinite(p.year) ||
      !Number.isFinite(p.month) ||
      !Number.isFinite(p.day)
    ) {
      return "";
    }
    const pad = (value: number) => String(value).padStart(2, "0");
    return `${p.year}-${pad(p.month)}-${pad(p.day)}T${pad(p.hour)}:${pad(p.minute)}`;
  } catch {
    return "";
  }
}

/**
 * Convert a `YYYY-MM-DD` date + `HH:mm` wall-clock in `timeZone` (the
 * profile timezone) to a UTC ISO instant for the API write contract. The
 * API only accepts offset-aware instants (#66), so the client must do this
 * conversion — never send the offset-naive `YYYY-MM-DDTHH:mm` string.
 * Returns `""` for invalid input (callers should surface a validation
 * error rather than send a corrupt instant).
 */
export function zonedWallToIso(
  dateStr: string,
  timeStr: string,
  timeZone: string,
): string {
  const dateMatch = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateStr?.trim() ?? "");
  const timeMatch = /^(\d{2}):(\d{2})$/.exec(timeStr?.trim() ?? "");
  if (!dateMatch || !timeMatch) return "";
  const year = Number(dateMatch[1]);
  const month = Number(dateMatch[2]);
  const day = Number(dateMatch[3]);
  const hour = Number(timeMatch[1]);
  const minute = Number(timeMatch[2]);
  if (
    !Number.isInteger(year) ||
    !Number.isInteger(month) ||
    month < 1 ||
    month > 12 ||
    !Number.isInteger(day) ||
    day < 1 ||
    day > 31 ||
    !Number.isInteger(hour) ||
    hour > 23 ||
    !Number.isInteger(minute) ||
    minute > 59
  ) {
    return "";
  }
  try {
    const instant = fromZonedTime(year, month, day, hour, minute, 0, timeZone);
    if (Number.isNaN(instant.getTime())) return "";
    return instant.toISOString();
  } catch {
    return "";
  }
}

const DEADLINE_DISPLAY_LOCALE = "en-US";

const MONTHS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
] as const;

/** Format a deadline for UI display. Deterministic across SSR and client. */
export function formatDeadline(
  iso: string,
  timeZone = "UTC",
  timeFormat: TimeFormat = "24h",
): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;

  const parts = getFormatter("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: true,
  }).formatToParts(date);

  const field = (type: Intl.DateTimeFormatPartTypes): string =>
    parts.find((part) => part.type === type)?.value ?? "";
  const year = field("year");
  const month = Number(field("month"));
  const day = Number(field("day"));
  const hour = Number(field("hour"));
  const minute = field("minute");
  const dayPeriod = field("dayPeriod");

  const time =
    timeFormat === "24h"
      ? formatTime24h(hour, minute, dayPeriod)
      : `${hour % 12 === 0 ? 12 : hour % 12}:${minute} ${dayPeriod}`;

  return `${MONTHS[month - 1]} ${day}, ${year}, ${time}`;
}

/** Convert the 12-hour parts from Intl into a zero-padded 24-hour `HH:MM`. */
function formatTime24h(hour12: number, minute: string, dayPeriod: string): string {
  const hour24 = hour12 % 12 + (dayPeriod === "PM" ? 12 : 0);
  return `${String(hour24).padStart(2, "0")}:${minute}`;
}

/**
 * Canonical time-only formatter. Single source of truth for user-facing times.
 * `24h` → `14:30`; `12h` → `2:30 PM`. Timezone selects the instant's wall
 * clock; timeFormat only changes presentation.
 */
export function formatTime(
  iso: string,
  timeFormat: TimeFormat = "24h",
  timeZone = "UTC",
): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  if (timeFormat === "24h") {
    return getFormatter(DEADLINE_DISPLAY_LOCALE, {
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
      timeZone,
    }).format(date);
  }
  return getFormatter(DEADLINE_DISPLAY_LOCALE, {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
    timeZone,
  }).format(date);
}

/** Format a deadline time without date for compact lists. */
export function formatDeadlineTime(
  iso: string,
  timeZone = "UTC",
  timeFormat: TimeFormat = "24h",
): string {
  return formatTime(iso, timeFormat, timeZone);
}

/** Format a deadline date without time for compact lists. */
export function formatDeadlineDate(iso: string, timeZone = "UTC"): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return getFormatter(DEADLINE_DISPLAY_LOCALE, {
    month: "short",
    day: "numeric",
    timeZone,
  }).format(date);
}
