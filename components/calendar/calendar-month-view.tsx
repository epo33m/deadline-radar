import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  formatMonthHeading,
  formatMonthParam,
  shiftMonth,
  WEEKDAY_LABELS,
  type CalendarCell,
  type CalendarMonth,
  type CalendarTask,
} from "@/lib/calendar/month";

type CalendarMonthViewProps = {
  month: CalendarMonth;
  timeZone: string;
  todayKey: string;
  cells: CalendarCell[];
  tasksByDay: Map<string, CalendarTask[]>;
};

function CalendarTaskChip({ task }: { task: CalendarTask }) {
  const isDone = task.status === "done";

  return (
    <Link
      href={`/tasks/${task.id}`}
      className={`flex min-w-0 items-center gap-1 rounded px-1 py-0.5 text-xs hover:bg-muted ${
        isDone ? "text-ink-muted-48 line-through" : "text-ink"
      }`}
      title={task.title}
    >
      <span
        aria-hidden
        className="size-2 shrink-0 rounded-sm border border-hairline"
        style={{ backgroundColor: task.course_color ?? "transparent" }}
      />
      <span className="truncate">{task.title}</span>
    </Link>
  );
}

function CalendarDayCell({
  cell,
  tasks,
  isToday,
}: {
  cell: CalendarCell;
  tasks: CalendarTask[];
  isToday: boolean;
}) {
  return (
    <div
      className={`min-h-28 border-b border-r border-hairline p-2 last:border-r-0 ${
        cell.inCurrentMonth ? "bg-canvas" : "bg-muted/20"
      }`}
    >
      <div className="mb-1 flex items-center justify-between gap-1">
        <span
          className={`inline-flex size-7 items-center justify-center rounded-full text-sm ${
            isToday
              ? "bg-primary font-semibold text-primary-foreground"
              : cell.inCurrentMonth
                ? "text-ink"
                : "text-ink-muted-48"
          }`}
        >
          {cell.day}
        </span>
      </div>
      <ul className="space-y-1">
        {tasks.slice(0, 3).map((task) => (
          <li key={task.id}>
            <CalendarTaskChip task={task} />
          </li>
        ))}
        {tasks.length > 3 ? (
          <li className="px-1 text-xs text-ink-muted-48">
            +{tasks.length - 3} more
          </li>
        ) : null}
      </ul>
    </div>
  );
}

export function CalendarMonthView({
  month,
  timeZone,
  todayKey,
  cells,
  tasksByDay,
}: CalendarMonthViewProps) {
  const previous = shiftMonth(month.year, month.month, -1);
  const next = shiftMonth(month.year, month.month, 1);
  const currentMonthParam = formatMonthParam(month);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="font-display text-xl font-semibold">
          {formatMonthHeading(month, timeZone)}
        </h2>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            nativeButton={false}
            render={<Link href="/calendar" />}
          >
            Today
          </Button>
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

      <div className="overflow-x-auto rounded-lg border border-hairline">
        <div className="min-w-[42rem]">
          <div className="grid grid-cols-7 border-b border-hairline bg-muted/30">
            {WEEKDAY_LABELS.map((label) => (
              <div
                key={label}
                className="px-2 py-2 text-center text-xs font-medium text-ink-muted-48"
              >
                {label}
              </div>
            ))}
          </div>
          <div className="grid grid-cols-7">
            {cells.map((cell) => (
              <CalendarDayCell
                key={`${currentMonthParam}-${cell.dayKey}`}
                cell={cell}
                tasks={tasksByDay.get(cell.dayKey) ?? []}
                isToday={cell.dayKey === todayKey}
              />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
