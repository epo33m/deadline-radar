import { getZonedDayKey } from "@/lib/calendar/month";

const MS_PER_DAY = 24 * 60 * 60 * 1000;

function dayKeyToUtcMs(dayKey: string): number {
  const [year, month, day] = dayKey.split("-").map(Number);
  return Date.UTC(year, month - 1, day);
}

function diffCalendarDays(
  deadlineIso: string,
  now: Date,
  timeZone: string,
): number | null {
  const deadlineKey = getZonedDayKey(deadlineIso, timeZone);
  const nowKey = getZonedDayKey(now.toISOString(), timeZone);
  if (!deadlineKey || !nowKey) return null;

  return Math.round(
    (dayKeyToUtcMs(deadlineKey) - dayKeyToUtcMs(nowKey)) / MS_PER_DAY,
  );
}

export function formatRelativeDeadline(
  iso: string,
  timeZone: string,
  now: Date = new Date(),
): string {
  const diff = diffCalendarDays(iso, now, timeZone);
  if (diff === null) return "";

  if (diff < 0) {
    const days = Math.abs(diff);
    return days === 1 ? "1 day overdue" : `${days} days overdue`;
  }

  if (diff === 0) return "Due today";
  if (diff === 1) return "in 1 day";
  return `in ${diff} days`;
}
