"use client";

import { useActionState } from "react";

import {
  softDeleteTask,
  type TaskActionState,
} from "@/app/actions/tasks";
import { TaskForm } from "@/components/tasks/task-form";
import { Button } from "@/components/ui/button";
import { formatDeadline } from "@/lib/datetime";
import type { TaskStatus } from "@/lib/validation/task";
import type { CourseListItem } from "@/types/course";
import type { ReminderThreshold, TaskDetail } from "@/types/task";

const initialState: TaskActionState = {};

const STATUS_LABEL: Record<TaskStatus, string> = {
  todo: "To do",
  in_progress: "In progress",
  done: "Done",
};

type TaskDetailPanelProps = {
  task: TaskDetail;
  courses: CourseListItem[];
  thresholds: ReminderThreshold[];
};

function SoftDeleteButton({ taskId }: { taskId: string }) {
  const [state, formAction, pending] = useActionState(
    softDeleteTask,
    initialState,
  );

  return (
    <form action={formAction}>
      <input type="hidden" name="id" value={taskId} />
      <Button
        type="submit"
        variant="outline"
        size="sm"
        disabled={pending}
        className="text-destructive"
      >
        {pending ? "Removing…" : "Remove task"}
      </Button>
      {state.error ? (
        <p className="mt-2 text-sm text-destructive" role="alert">
          {state.error}
        </p>
      ) : null}
    </form>
  );
}

export function TaskDetailPanel({
  task,
  courses,
  thresholds,
}: TaskDetailPanelProps) {
  const sortedThresholds = [...thresholds].sort(
    (a, b) => b.days_before - a.days_before,
  );

  return (
    <div className="space-y-10">
      <div className="space-y-2">
        <p className="text-sm text-ink-muted-48">
          {task.course_name ?? "Course"}
          {task.course_code ? ` · ${task.course_code}` : ""} ·{" "}
          {STATUS_LABEL[task.status]} · Due {formatDeadline(task.deadline)}
        </p>
        {task.description ? (
          <p className="whitespace-pre-wrap text-ink">{task.description}</p>
        ) : (
          <p className="text-sm text-ink-muted-48">No description.</p>
        )}
        {task.estimated_duration != null ? (
          <p className="text-sm text-ink-muted-48">
            Estimated duration: {task.estimated_duration} minutes
          </p>
        ) : null}
      </div>

      <div className="space-y-4">
        <h2 className="font-display text-xl font-semibold">Reminder thresholds</h2>
        <p className="text-sm text-ink-muted-48">
          Default H-7 / H-3 / H-1 / H-0 are created with the task. Thresholds
          already past at creation are kept but not fired retroactively by the
          scheduler.
        </p>
        {sortedThresholds.length === 0 ? (
          <p className="text-sm text-ink-muted-48">
            No thresholds found. Confirm the tasks migration is applied.
          </p>
        ) : (
          <ul className="border-t border-hairline">
            {sortedThresholds.map((threshold) => (
              <li
                key={threshold.id}
                className="flex items-center justify-between border-b border-hairline py-3 text-sm last:border-b-0"
              >
                <span className="font-medium text-ink">
                  H-{threshold.days_before}
                </span>
                <span className="text-ink-muted-48">
                  {threshold.is_default ? "Default" : "Custom"} ·{" "}
                  {threshold.days_before === 0
                    ? "At deadline"
                    : `${threshold.days_before} day${threshold.days_before === 1 ? "" : "s"} before`}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="space-y-4">
        <h2 className="font-display text-xl font-semibold">Edit task</h2>
        <TaskForm task={task} courses={courses} submitLabel="Save changes" />
      </div>

      <div className="space-y-2">
        <h2 className="font-display text-xl font-semibold">Remove</h2>
        <p className="text-sm text-ink-muted-48">
          Soft-deletes this task. It will leave active lists; hard delete is not
          used.
        </p>
        <SoftDeleteButton taskId={task.id} />
      </div>
    </div>
  );
}
