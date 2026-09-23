/**
 * Summary bucket counts — the canonical definition shared by every consumer.
 *
 * Semantics (single source of truth, mirrored from the original web logic):
 * - Buckets are calendar-day windows compared by YYYY-MM-DD day key in the
 *   user's timezone, rolling forward from `now`: `thisWeek`/`nextWeek`
 *   are 7/14-day rolling windows, `thisMonth` a 30-day rolling window.
 *   End keys (`today + 7`, `today + 14`, `today + 30`) are INCLUSIVE.
 * - `done` tasks are excluded from every bucket (including `allTasks`).
 * - `missed` counts non-done tasks whose deadline instant is before `now`;
 *   such tasks STILL count toward their calendar bucket.
 * - A deadline that cannot be parsed still increments `allTasks` but never
 *   `missed` nor any calendar bucket.
 */

export const THIS_WEEK_DAYS = 7;
export const NEXT_WEEK_DAYS = 14;
export const THIS_MONTH_DAYS = 30;

export type WeekSummary = {
  today: number;
  tomorrow: number;
  thisWeek: number;
  nextWeek: number;
  thisMonth: number;
  missed: number;
  allTasks: number;
};

export type SummaryBucketTask = {
  deadline: string;
  status: string;
};

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/** Map an instant to a YYYY-MM-DD wall-clock key in the given timezone. */
function zonedDayKey(iso: string, timeZone: string): string | null {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const year = parts.find((p) => p.type === "year")?.value;
  const month = parts.find((p) => p.type === "month")?.value;
  const day = parts.find((p) => p.type === "day")?.value;
  if (!year || !month || !day) return null;
  return `${year}-${month}-${day}`;
}

function emptySummary(): WeekSummary {
  return {
    today: 0,
    tomorrow: 0,
    thisWeek: 0,
    nextWeek: 0,
    thisMonth: 0,
    missed: 0,
    allTasks: 0,
  };
}

export function summarizeDeadlineBuckets(
  tasks: SummaryBucketTask[],
  timeZone: string,
  now: Date = new Date(),
): WeekSummary {
  const counts = emptySummary();

  const nowMs = now.getTime();
  const todayKey = zonedDayKey(now.toISOString(), timeZone);
  if (!todayKey) return counts;

  const tomorrowKey = zonedDayKey(
    new Date(nowMs + MS_PER_DAY).toISOString(),
    timeZone,
  );
  const thisWeekEndKey = zonedDayKey(
    new Date(nowMs + THIS_WEEK_DAYS * MS_PER_DAY).toISOString(),
    timeZone,
  );
  const nextWeekEndKey = zonedDayKey(
    new Date(nowMs + NEXT_WEEK_DAYS * MS_PER_DAY).toISOString(),
    timeZone,
  );
  const thisMonthEndKey = zonedDayKey(
    new Date(nowMs + THIS_MONTH_DAYS * MS_PER_DAY).toISOString(),
    timeZone,
  );
  if (
    !tomorrowKey ||
    !thisWeekEndKey ||
    !nextWeekEndKey ||
    !thisMonthEndKey
  ) {
    return counts;
  }

  const isWithin = (dayKey: string | null, start: string, end: string) =>
    dayKey !== null && dayKey >= start && dayKey <= end;

  for (const task of tasks) {
    if (task.status === "done") continue;

    counts.allTasks += 1;

    const deadlineMs = new Date(task.deadline).getTime();
    if (!Number.isNaN(deadlineMs) && deadlineMs < nowMs) {
      counts.missed += 1;
    }

    const dayKey = zonedDayKey(task.deadline, timeZone);
    if (!dayKey) continue;

    if (dayKey === todayKey) counts.today += 1;
    if (dayKey === tomorrowKey) counts.tomorrow += 1;
    if (isWithin(dayKey, todayKey, thisWeekEndKey)) counts.thisWeek += 1;
    else if (isWithin(dayKey, thisWeekEndKey, nextWeekEndKey)) {
      counts.nextWeek += 1;
    }
    if (isWithin(dayKey, todayKey, thisMonthEndKey)) counts.thisMonth += 1;
  }

  return counts;
}