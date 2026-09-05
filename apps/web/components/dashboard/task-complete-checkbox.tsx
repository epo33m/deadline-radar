"use client";

import { Loader2 } from "lucide-react";
import { useActionState } from "react";

import {
  completeTask,
  type TaskActionState,
} from "@/app/actions/tasks";

const initialState: TaskActionState = {};

type TaskCompleteCheckboxProps = {
  taskId: string;
  taskTitle: string;
};

export function TaskCompleteCheckbox({
  taskId,
  taskTitle,
}: TaskCompleteCheckboxProps) {
  const [state, formAction, pending] = useActionState(
    completeTask,
    initialState,
  );

  return (
    <form action={formAction} className="shrink-0">
      <input type="hidden" name="id" value={taskId} />
      <button
        type="submit"
        disabled={pending}
        aria-label={`Mark "${taskTitle}" as complete`}
        className="mt-0.5 inline-flex size-4 items-center justify-center rounded-full border border-hairline text-ink-muted-48 transition-colors hover:border-primary hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-focus disabled:opacity-60"
      >
        {pending ? (
          <Loader2 className="size-3 animate-spin" aria-hidden="true" />
        ) : (
          <span className="sr-only">Incomplete</span>
        )}
      </button>
      {state.error ? (
        <span className="sr-only" role="alert">
          {state.error}
        </span>
      ) : null}
    </form>
  );
}
