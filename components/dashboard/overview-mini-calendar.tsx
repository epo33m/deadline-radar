import Link from "next/link";

import {
  buildMonthGrid,
  formatMonthHeading,
  getZonedDayKey,
  groupTasksByDay,
  parseMonthParam,
  type CalendarTask,
  WEEKDAY_LABELS,
} from "@/lib/calendar/month";

type OverviewMiniCalendarProps = {
  tasks: CalendarTask[];
  timeZone: string;
  now?: Date;
};

export function OverviewMiniCalendar({
  tasks,
  timeZone,
  now = new Date(),
}: OverviewMiniCalendarProps) {
  const month = parseMonthParam(undefined, timeZone, now);
  const cells = buildMonthGrid(month.year, month.month, timeZone);
  const tasksByDay = groupTasksByDay(tasks, timeZone);
  const todayKey = getZonedDayKey(now.toISOString(), timeZone);

  return (
    <section className="space-y-3">
      <div className="space-y-1">
        <h2 className="font-display text-lg font-semibold text-ink">
          {formatMonthHeading(month, timeZone)}
        </h2>
      </div>

      <div className="rounded-xl border border-hairline bg-canvas p-3">
        <div className="grid grid-cols-7 gap-1 text-center text-[11px] text-ink-muted-48">
          {WEEKDAY_LABELS.map((label) => (
            <div key={label} className="py-1 font-medium">
              {label}
            </div>
          ))}
        </div>

        <div className="grid grid-cols-7 gap-1">
          {cells.map((cell) => {
            const hasTasks = (tasksByDay.get(cell.dayKey)?.length ?? 0) > 0;
            const isToday = cell.dayKey === todayKey;

            return (
              <div
                key={cell.dayKey}
                className={`flex aspect-square items-center justify-center rounded-md text-xs ${
                  cell.inCurrentMonth ? "text-ink" : "text-ink-muted-48"
                } ${isToday ? "bg-primary font-semibold text-primary-foreground" : ""}`}
              >
                <span className="relative">
                  {cell.day}
                  {hasTasks && !isToday ? (
                    <span
                      aria-hidden
                      className="absolute -bottom-1 left-1/2 size-1 -translate-x-1/2 rounded-full bg-primary"
                    />
                  ) : null}
                </span>
              </div>
            );
          })}
        </div>
      </div>

      <Link
        href="/calendar"
        className="inline-flex text-sm text-primary hover:underline focus-visible:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-focus"
      >
        View calendar →
      </Link>
    </section>
  );
}
