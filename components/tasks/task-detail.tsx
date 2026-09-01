"use client";

import { useActionState } from "react";

import {
  softDeleteTask,
  type TaskActionState,
} from "@/app/actions/tasks";
import { TaskForm } from "@/components/tasks/task-form";
import { ThresholdManager } from "@/components/tasks/threshold-manager";
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

      <ThresholdManager taskId={task.id} thresholds={thresholds} />

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
