/** Format a timestamptz ISO string for `<input type="datetime-local" />`. */
export function toDatetimeLocalValue(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

const DEADLINE_DISPLAY_LOCALE = "en-US";

/** Format a deadline for UI display. Locale and timezone are fixed for SSR/hydration. */
export function formatDeadline(iso: string, timeZone = "UTC"): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return new Intl.DateTimeFormat(DEADLINE_DISPLAY_LOCALE, {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone,
  }).format(date);
}
