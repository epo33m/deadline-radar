"use client";

import Link from "next/link";
import { useActionState } from "react";

import {
  softDeleteTask,
  type TaskActionState,
} from "@/app/actions/tasks";
import { Button } from "@/components/ui/button";
import { formatDeadline } from "@/lib/datetime";
import type { TaskStatus } from "@/lib/validation/task";
import type { TaskListItem } from "@/types/task";

const initialState: TaskActionState = {};

const STATUS_LABEL: Record<TaskStatus, string> = {
  todo: "To do",
  in_progress: "In progress",
  done: "Done",
};

type TaskListProps = {
  tasks: TaskListItem[];
};

function SoftDeleteButton({ taskId }: { taskId: string }) {
  const [state, formAction, pending] = useActionState(
    softDeleteTask,
    initialState,
  );

  return (
    <form action={formAction} className="inline">
      <input type="hidden" name="id" value={taskId} />
      <Button
        type="submit"
        variant="outline"
        size="sm"
        disabled={pending}
        className="text-destructive"
      >
        {pending ? "Removing…" : "Remove"}
      </Button>
      {state.error ? (
        <p className="mt-2 text-sm text-destructive" role="alert">
          {state.error}
        </p>
      ) : null}
    </form>
  );
}

function TaskRow({ task }: { task: TaskListItem }) {
  return (
    <li className="border-b border-hairline py-4 last:border-b-0">
      <div className="flex flex-wrap items-start justify-between gap-3">
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
              {task.course_name ?? "Course"} · {formatDeadline(task.deadline)} ·{" "}
              {STATUS_LABEL[task.status]}
            </p>
          </div>
        </div>
        <SoftDeleteButton taskId={task.id} />
      </div>
    </li>
  );
}

export function TaskList({ tasks }: TaskListProps) {
  if (tasks.length === 0) {
    return (
      <p className="text-sm text-ink-muted-48">
        No tasks yet. Add one with a course and deadline.
      </p>
    );
  }

  return (
    <ul className="border-t border-hairline">
      {tasks.map((task) => (
        <TaskRow key={task.id} task={task} />
      ))}
    </ul>
  );
}
