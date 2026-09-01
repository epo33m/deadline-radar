import Link from "next/link";

import { formatDeadline } from "@/lib/datetime";
import type { DashboardTask } from "@/lib/dashboard/summaries";
import type { TaskStatus } from "@/lib/validation/task";

const STATUS_LABEL: Record<TaskStatus, string> = {
  todo: "To do",
  in_progress: "In progress",
  done: "Done",
};

type TaskSummaryListProps = {
  tasks: DashboardTask[];
  emptyMessage: string;
  /** When set, show completion time instead of deadline (recently completed). */
  showCompletedAt?: boolean;
};

function TaskSummaryRow({
  task,
  showCompletedAt,
}: {
  task: DashboardTask;
  showCompletedAt?: boolean;
}) {
  return (
    <li className="border-b border-hairline py-3 last:border-b-0">
      <div className="flex min-w-0 items-start gap-3">
        <span
          aria-hidden
          className="mt-1 size-3 shrink-0 rounded-sm border border-hairline"
          style={{
            backgroundColor: task.course_color ?? "transparent",
          }}
        />
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
              ? `Completed ${formatDeadline(task.updated_at)}`
              : `Due ${formatDeadline(task.deadline)}`}{" "}
            · {STATUS_LABEL[task.status]}
          </p>
        </div>
      </div>
    </li>
  );
}

export function TaskSummaryList({
  tasks,
  emptyMessage,
  showCompletedAt,
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
          showCompletedAt={showCompletedAt}
        />
      ))}
    </ul>
  );
}
