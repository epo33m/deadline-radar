import type { TimeFormat } from "@deadline-radar/validation";

export type { TimeFormat } from "@deadline-radar/validation";

/** Format a timestamptz ISO string for `<input type="datetime-local" />`. */
export function toDatetimeLocalValue(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
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

  const parts = new Intl.DateTimeFormat("en-US", {
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
    return new Intl.DateTimeFormat(DEADLINE_DISPLAY_LOCALE, {
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
      timeZone,
    }).format(date);
  }
  return new Intl.DateTimeFormat(DEADLINE_DISPLAY_LOCALE, {
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
  return new Intl.DateTimeFormat(DEADLINE_DISPLAY_LOCALE, {
    month: "short",
    day: "numeric",
    timeZone,
  }).format(date);
}
