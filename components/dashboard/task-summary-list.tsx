import Link from "next/link";
import { Check } from "lucide-react";

import { formatDeadline } from "@/lib/datetime";
import { formatRelativeDeadline } from "@/lib/dashboard/deadline-relative";
import type { DashboardTask } from "@/lib/dashboard/summaries";

type TaskSummaryListProps = {
  tasks: DashboardTask[];
  emptyMessage: string;
  timeZone: string;
  showCompletedAt?: boolean;
  emphasizeRelative?: boolean;
};

function TaskSummaryRow({
  task,
  timeZone,
  showCompletedAt,
  emphasizeRelative,
}: {
  task: DashboardTask;
  timeZone: string;
  showCompletedAt?: boolean;
  emphasizeRelative?: boolean;
}) {
  const relativeLabel = showCompletedAt
    ? null
    : formatRelativeDeadline(task.deadline, timeZone);

  return (
    <li className="border-b border-hairline py-3 last:border-b-0">
      <div className="flex min-w-0 items-start justify-between gap-4">
        <div className="flex min-w-0 items-start gap-3">
          {showCompletedAt ? (
            <Check
              className="mt-0.5 size-4 shrink-0 text-ink-muted-48"
              aria-hidden="true"
            />
          ) : (
            <span
              aria-hidden
              className="mt-1 size-3 shrink-0 rounded-full border border-hairline"
              style={{
                backgroundColor: task.course_color ?? "transparent",
              }}
            />
          )}
          <div className="min-w-0 space-y-1">
            <Link
              href={`/tasks/${task.id}`}
              className="font-medium text-ink hover:text-primary"
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
        {relativeLabel && emphasizeRelative !== false ? (
          <span
            className={`shrink-0 text-sm ${
              relativeLabel.includes("overdue")
                ? "font-medium text-destructive"
                : "text-ink-muted-48"
            }`}
          >
            {relativeLabel}
          </span>
        ) : null}
      </div>
    </li>
  );
}

export function TaskSummaryList({
  tasks,
  emptyMessage,
  timeZone,
  showCompletedAt,
  emphasizeRelative,
}: TaskSummaryListProps) {
  if (tasks.length === 0) {
    return <p className="text-sm text-ink-muted-48">{emptyMessage}</p>;
  }

  return (
    <ul className="border-t border-hairline">
      {tasks.map((task) => (
        <TaskSummaryRow
          key={task.id}
          task={task}
          timeZone={timeZone}
          showCompletedAt={showCompletedAt}
          emphasizeRelative={emphasizeRelative}
        />
      ))}
    </ul>
  );
}
