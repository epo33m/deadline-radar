import Link from "next/link";
import { Check } from "lucide-react";

import { formatDeadline, formatDeadlineDate } from "@/lib/datetime";
import { formatRelativeDeadline } from "@/lib/deadline-relative";
import type { OverviewTask } from "@/lib/overview/summaries";

import { StatusPill } from "./status-pill";
import { SectionEmptyState, type SectionTone } from "./section-empty-state";
import { TaskCompleteCheckbox } from "./task-complete-checkbox";

type TaskSummaryListProps = {
  tasks: OverviewTask[];
  emptyTone: SectionTone;
  timeZone: string;
  showCompletedAt?: boolean;
};

function TaskSummaryRow({
  task,
  timeZone,
  showCompletedAt,
}: {
  task: OverviewTask;
  timeZone: string;
  showCompletedAt?: boolean;
}) {
  const relativeLabel = showCompletedAt
    ? null
    : formatRelativeDeadline(task.deadline, timeZone);

  return (
    <li className="border-b border-hairline py-3 last:border-b-0">
      <div className="flex min-w-0 flex-col gap-2 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
        <div className="flex min-w-0 items-start gap-3">
          {showCompletedAt ? (
            <span
              className="mt-0.5 inline-flex size-4 shrink-0 items-center justify-center rounded-full bg-success/10 text-success"
              aria-hidden="true"
            >
              <Check className="size-3" />
            </span>
          ) : (
            <TaskCompleteCheckbox taskId={task.id} taskTitle={task.title} />
          )}
          <div className="min-w-0 space-y-1">
            <Link
              href={`/tasks/${task.id}`}
              className="font-medium text-ink hover:text-primary focus-visible:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-focus"
            >
              {task.title}
            </Link>
            <p className="text-sm text-ink-muted-48">
              {task.course_name ?? "Course"} ·{" "}
              {showCompletedAt
                ? `Completed ${formatDeadline(task.updated_at, timeZone)}`
                : `Due ${formatDeadline(task.deadline, timeZone)}`}
            </p>
          </div>
        </div>
        {showCompletedAt ? (
          <StatusPill tone="completed" className="self-start sm:shrink-0">
            Completed {formatDeadlineDate(task.updated_at, timeZone)}
          </StatusPill>
        ) : relativeLabel ? (
          <StatusPill
            className="self-start sm:shrink-0"
            tone={
              relativeLabel.includes("overdue")
                ? "overdue"
                : relativeLabel.startsWith("in ")
                  ? "due-soon"
                  : "due-soon"
            }
          >
            {relativeLabel}
          </StatusPill>
        ) : null}
      </div>
    </li>
  );
}

export function TaskSummaryList({
  tasks,
  emptyTone,
  timeZone,
  showCompletedAt,
}: TaskSummaryListProps) {
  if (tasks.length === 0) {
    return (
      <SectionEmptyState tone={emptyTone} />
    );
  }

  return (
    <ul className="border-t border-hairline">
      {tasks.map((task) => (
        <TaskSummaryRow
          key={task.id}
          task={task}
          timeZone={timeZone}
          showCompletedAt={showCompletedAt}
        />
      ))}
    </ul>
  );
}
