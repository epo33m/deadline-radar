"use client";

import { memo, useState } from "react";
import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";
import type { TimeFormat } from "@deadline-radar/validation";

import { Button } from "@/components/ui/button";
import {
  formatDayLabel,
  formatMonthHeadingParts,
  formatMonthShortName,
  truncateTitle,
  formatMonthParam,
  getZonedDayKey,
  shiftMonth,
  WEEKDAY_LABELS,
  type CalendarCell,
  type CalendarMonth,
  type CalendarTask,
} from "@/lib/calendar/month";
import { getCourseColorFill } from "@/lib/courses/colors";
import { formatDeadlineTime } from "@/lib/datetime";
import { useNow } from "@/lib/use-now";

type CalendarMonthViewProps = {
  month: CalendarMonth;
  timeZone: string;
  timeFormat: TimeFormat;
  todayKey: string;
  nowIso?: string;
  cells: CalendarCell[];
  tasksByDay: Map<string, CalendarTask[]>;
};

/**
 * Memoized: props are memo-stable across the 60s `useNow` tick (task object
 * identity comes from the server-provided map; the rest are primitives), so
 * unchanged chips skip re-render.
 */
const CalendarTaskChip = memo(function CalendarTaskChip({
  task,
  timeZone,
  timeFormat,
}: {
  task: CalendarTask;
  timeZone: string;
  timeFormat: TimeFormat;
}) {
  const isDone = task.status === "done";

  return (
    <Link
      href={`/tasks/${task.id}`}
      style={{
        backgroundColor:
          getCourseColorFill(task.course_color) ?? "transparent",
      }}
      className={`relative flex w-full min-w-0 items-center gap-0.5 rounded-md px-1 py-1 text-[11px] sm:gap-1 sm:text-xs ${
        isDone ? "text-ink-muted-48" : "text-ink"
      }`}
      title={task.title}
    >
      {isDone ? (
        <span
          aria-hidden
          className="pointer-events-none absolute top-1/2 right-1 left-1 h-px -translate-y-1/2 bg-ink"
        />
      ) : null}
      <span className="min-w-0 flex-1 truncate font-medium text-xs sm:text-[13px]">
        {truncateTitle(task.title)}
      </span>
      <span className="hidden shrink-0 text-[10px] tabular-nums sm:inline sm:text-[11px]">
        {formatDeadlineTime(task.deadline, timeZone, timeFormat)}
      </span>
    </Link>
  );
});

/**
 * Memoized: `onSelect` is a stable setter and the rest are memo-stable
 * (server-provided cell/tasks references, primitive flags), so day cells
 * skip re-render on the 60s tick and on unrelated selection changes.
 */
const CalendarDayCell = memo(function CalendarDayCell({
  cell,
  tasks,
  isToday,
  isSelected,
  onSelect,
  timeZone,
  timeFormat,
}: {
  cell: CalendarCell;
  tasks: CalendarTask[];
  isToday: boolean;
  isSelected: boolean;
  onSelect: (dayKey: string) => void;
  timeZone: string;
  timeFormat: TimeFormat;
}) {
  const dayLabel = formatDayLabel(cell.dayKey, cell.day);
  const isMonthStart = cell.day === 1;
  const monthPrefix = isMonthStart ? formatMonthShortName(cell.dayKey) : null;

  return (
    <div
      className={`min-h-14 px-1 py-0.5 sm:min-h-28 sm:border-r sm:border-hairline sm:p-2 sm:last:border-r-0 ${
        cell.inCurrentMonth ? "bg-canvas" : "bg-muted/20"
      }`}
    >
      <div className="flex items-center justify-center gap-1 sm:-mt-1 sm:justify-end">
        <button
          type="button"
          onClick={() => onSelect(cell.dayKey)}
          aria-pressed={isSelected}
          aria-label={`Select ${dayLabel}`}
          className={`${cell.inCurrentMonth ? "inline-flex" : "hidden"} h-7 cursor-pointer items-center justify-center rounded-full font-medium text-[15px] whitespace-nowrap sm:hidden ${
            isSelected || isToday ? "w-7" : ""
          } ${
            isSelected
              ? "bg-primary font-semibold text-primary-foreground"
              : isToday
                ? "font-semibold text-destructive"
                : cell.inCurrentMonth
                  ? "text-ink"
                  : "text-ink-muted-48"
          }`}
        >
          {cell.day}
        </button>
        <span
          className={`hidden h-7 items-center justify-center rounded-full text-sm whitespace-nowrap sm:inline-flex ${
            isToday ? (isMonthStart ? "px-2" : "w-7") : ""
          } ${
            isToday
              ? "bg-primary font-semibold text-primary-foreground"
              : cell.inCurrentMonth
                ? "text-ink"
                : "text-ink-muted-48"
          }`}
        >
          {monthPrefix ? (
            <>
              <span className="font-bold">{monthPrefix}</span>
              <span className="ml-1">{cell.day}</span>
            </>
          ) : (
            dayLabel
          )}
        </span>
      </div>
      <ul className="mt-1 sm:hidden">
        {tasks.length > 0 ? (
          <li className="flex flex-col items-center gap-1">
            {Array.from(
              { length: Math.ceil(Math.min(tasks.length, 6) / 3) },
              (_, rowIndex) => (
                <span
                  key={rowIndex}
                  className="flex items-center justify-center gap-1"
                >
                  {tasks
                    .slice(rowIndex * 3, rowIndex * 3 + 3)
                    .map((task) => {
                      const fill = getCourseColorFill(task.course_color);
                      return (
                        <Link
                          key={task.id}
                          href={`/tasks/${task.id}`}
                          title={task.title}
                          aria-label={task.title}
                          style={
                            fill ? { backgroundColor: fill } : undefined
                          }
                          className={`size-2 rounded-full ${
                            fill ? "" : "bg-ink-muted-48"
                          } ${task.status === "done" ? "opacity-40" : ""}`}
                        />
                      );
                    })}
                </span>
              ),
            )}
            {tasks.length > 6 ? (
              <span className="text-[11px] font-medium text-ink-muted-48">
                +{tasks.length - 6}
              </span>
            ) : null}
          </li>
        ) : null}
      </ul>
      <ul className="mt-1 hidden space-y-1 sm:block">
        {tasks.slice(0, 3).map((task) => (
          <li key={task.id}>
            <CalendarTaskChip
              task={task}
              timeZone={timeZone}
              timeFormat={timeFormat}
            />
          </li>
        ))}
        {tasks.length > 3 ? (
          <li className="text-[11px] font-medium text-ink-muted-48 sm:text-xs">
            +{tasks.length - 3} more
          </li>
        ) : null}
      </ul>
    </div>
  );
});

export function CalendarMonthView({
  month,
  timeZone,
  timeFormat,
  todayKey,
  nowIso,
  cells,
  tasksByDay,
}: CalendarMonthViewProps) {
  const now = useNow(60_000, nowIso);
  const liveTodayKey = getZonedDayKey(now.toISOString(), timeZone) ?? todayKey;
  const previous = shiftMonth(month.year, month.month, -1);
  const next = shiftMonth(month.year, month.month, 1);
  const currentMonthParam = formatMonthParam(month);
  const heading = formatMonthHeadingParts(month, timeZone);
  const weeks: CalendarCell[][] = [];
  for (let i = 0; i < cells.length; i += 7) {
    weeks.push(cells.slice(i, i + 7));
  }
  const lastWeekCells = weeks[weeks.length - 1] ?? [];
  const lastInMonthIdx = lastWeekCells.reduce<number>(
    (acc, cell, idx) => (cell.inCurrentMonth ? idx : acc),
    -1,
  );
  const lastWeekPartial = lastInMonthIdx >= 0 && lastInMonthIdx < 6;
  const listedDays = cells.filter(
    (cell) =>
      cell.inCurrentMonth && (tasksByDay.get(cell.dayKey)?.length ?? 0) > 0,
  );
  const [selectedDayKey, setSelectedDayKey] = useState<string | null>(null);
  const [prevMonthParam, setPrevMonthParam] = useState(currentMonthParam);
  if (prevMonthParam !== currentMonthParam) {
    setPrevMonthParam(currentMonthParam);
    setSelectedDayKey(null);
  }
  const selectedKey =
    selectedDayKey ??
    (cells.some((cell) => cell.dayKey === liveTodayKey)
      ? liveTodayKey
      : (listedDays[0]?.dayKey ??
        cells.find((cell) => cell.inCurrentMonth)?.dayKey ??
        liveTodayKey));
  const selectedTasks = tasksByDay.get(selectedKey) ?? [];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="flex flex-1 items-baseline justify-between font-display text-xl font-semibold sm:flex-none sm:justify-start sm:gap-1">
          <span className="font-bold">{heading.month}</span>
          <span className="font-medium">{heading.year}</span>
        </h2>
        <div className="hidden items-center gap-1 sm:flex">
          <Button
            variant="outline"
            size="icon-sm"
            aria-label="Previous month"
            nativeButton={false}
            render={
              <Link href={`/calendar?month=${formatMonthParam(previous)}`} />
            }
          >
            <ChevronLeft />
          </Button>
          <Button
            variant="outline"
            size="icon-sm"
            aria-label="Next month"
            nativeButton={false}
            render={<Link href={`/calendar?month=${formatMonthParam(next)}`} />}
          >
            <ChevronRight />
          </Button>
        </div>
      </div>

      <div className="w-full">
        <div>
          <div className="grid grid-cols-7 gap-0.5 border-b border-hairline sm:gap-0">
            {WEEKDAY_LABELS.map((label) => (
              <div
                key={label}
                title={label}
                className="px-0 py-2 text-center text-sm font-bold text-ink-muted-48 sm:px-2 sm:py-2 sm:text-right sm:text-xs"
              >
                {label.slice(0, 1)}
              </div>
            ))}
          </div>
          <div>
            {weeks.map((week, weekIndex) => {
              const isLastWeek = weekIndex === weeks.length - 1;
              const isBeforePartialLast =
                weekIndex === weeks.length - 2 && lastWeekPartial;
              const bottomBorderClass = isLastWeek
                ? "border-b-2 border-hairline sm:border-b-0"
                : isBeforePartialLast
                  ? "border-b-0 sm:border-b sm:border-hairline"
                  : "border-b border-hairline";
              return (
                <div
                  key={`${currentMonthParam}-week-${weekIndex}`}
                  className={`grid grid-cols-7 gap-0.5 sm:gap-0 ${bottomBorderClass} ${
                    isLastWeek && lastWeekPartial ? "relative" : ""
                  }`}
                >
                  {isLastWeek && lastWeekPartial ? (
                    <div
                      aria-hidden
                      className="absolute top-0 left-0 border-t border-hairline sm:hidden"
                      style={{
                        width: `${((lastInMonthIdx + 1) / 7) * 100}%`,
                      }}
                    />
                  ) : null}
                  {week.map((cell) => (
                    <CalendarDayCell
                      key={`${currentMonthParam}-${cell.dayKey}`}
                      cell={cell}
                      tasks={tasksByDay.get(cell.dayKey) ?? []}
                      isToday={cell.dayKey === liveTodayKey}
                      isSelected={cell.dayKey === selectedKey}
                      onSelect={setSelectedDayKey}
                      timeZone={timeZone}
                      timeFormat={timeFormat}
                    />
                  ))}
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {selectedTasks.length > 0 ? (
        <div className="space-y-1.5 sm:hidden">
          <ul className="space-y-1.5">
            {selectedTasks.map((task) => {
              const fill = getCourseColorFill(task.course_color);
              const isDone = task.status === "done";
              return (
                <li key={task.id}>
                  <Link
                    href={`/tasks/${task.id}`}
                    style={{
                      backgroundColor: fill ?? "transparent",
                    }}
                    className={`relative flex items-center gap-2.5 rounded-lg px-3 py-2 ${
                      isDone ? "text-ink-muted-48" : "text-ink"
                    }`}
                  >
                    {isDone ? (
                      <span
                        aria-hidden
                        className="pointer-events-none absolute top-1/2 right-3 left-3 h-px -translate-y-1/2 bg-ink"
                      />
                    ) : null}
                    <span className="min-w-0 flex-1 truncate text-sm font-medium">
                      {task.title}
                    </span>
                    <span className="shrink-0 text-xs tabular-nums">
                      {formatDeadlineTime(task.deadline, timeZone, timeFormat)}
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      ) : null}

      <div className="pointer-events-none fixed inset-x-4 bottom-5 z-40 flex items-end justify-between sm:hidden">
        <Button
          variant="outline"
          size="lg"
          nativeButton={false}
          render={<Link href="/calendar" />}
          onClick={() => setSelectedDayKey(liveTodayKey)}
          className="pointer-events-auto h-12 rounded-full px-5 shadow-lg"
        >
          Today
        </Button>
        <div className="pointer-events-auto flex h-12 items-center gap-1.5 rounded-full border border-border bg-background p-1.5 shadow-lg">
          <Button
            variant="ghost"
            size="icon-lg"
            aria-label="Previous month"
            nativeButton={false}
            render={
              <Link href={`/calendar?month=${formatMonthParam(previous)}`} />
            }
          >
            <ChevronLeft className="size-5" />
          </Button>
          <Button
            variant="ghost"
            size="icon-lg"
            aria-label="Next month"
            nativeButton={false}
            render={<Link href={`/calendar?month=${formatMonthParam(next)}`} />}
          >
            <ChevronRight className="size-5" />
          </Button>
        </div>
      </div>
    </div>
  );
}
