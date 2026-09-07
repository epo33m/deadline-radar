"use client";

import { useActionState, useEffect, useRef, useState } from "react";

import {
  createTask,
  updateTask,
  type TaskActionState,
} from "@/app/actions/tasks";
import { Button } from "@/components/ui/button";
import {
  dialogActionsClassName,
  dialogPrimaryActionClassName,
  dialogSecondaryActionClassName,
} from "@/components/ui/dialog";
import {
  DialogFormRow,
  dialogFormListClassName,
  dialogInputClassName,
} from "@/components/ui/dialog-form";
import { Input } from "@/components/ui/input";
import { SelectMenu } from "@/components/ui/select-menu";
import { toDatetimeLocalValue } from "@/lib/datetime";
import type { TaskStatus } from "@/lib/validation/task";
import type { CourseListItem } from "@/types/course";
import type { TaskListItem } from "@/types/task";

const initialState: TaskActionState = {};

const STATUS_OPTIONS: { value: TaskStatus; label: string }[] = [
  { value: "todo", label: "To do" },
  { value: "in_progress", label: "In progress" },
  { value: "done", label: "Done" },
];

type TaskFormProps = {
  task?: Pick<
    TaskListItem,
    | "id"
    | "title"
    | "course_id"
    | "deadline"
    | "status"
    | "estimated_duration"
  > & { description?: string | null };
  courses: CourseListItem[];
  onSuccess?: () => void;
  onCancel?: () => void;
  submitLabel: string;
  defaultStatus?: TaskStatus;
  /** When set, course is fixed and not shown as a selectable field. */
  lockedCourseId?: string;
  /** After create, redirect here instead of the new task detail page. */
  returnTo?: string;
};

export function TaskForm({
  task,
  courses,
  onSuccess,
  onCancel,
  submitLabel,
  defaultStatus = "todo",
  lockedCourseId,
  returnTo,
}: TaskFormProps) {
  const action = task ? updateTask : createTask;
  const [state, formAction, pending] = useActionState(action, initialState);
  const [title, setTitle] = useState(task?.title ?? "");
  const [courseId, setCourseId] = useState(
    lockedCourseId ?? task?.course_id ?? courses[0]?.id ?? "",
  );
  const [deadline, setDeadline] = useState(
    task?.deadline ? toDatetimeLocalValue(task.deadline) : "",
  );
  const [status, setStatus] = useState<TaskStatus>(task?.status ?? defaultStatus);
  const [description, setDescription] = useState(task?.description ?? "");
  const [estimatedDuration, setEstimatedDuration] = useState(
    task?.estimated_duration != null ? String(task.estimated_duration) : "",
  );
  const wasPending = useRef(false);

  useEffect(() => {
    if (wasPending.current && !pending && !state.error) {
      onSuccess?.();
    }
    wasPending.current = pending;
  }, [pending, state.error, onSuccess]);

  if (courses.length === 0) {
    return (
      <p className="text-sm text-ink-muted-48">
        Add a course before creating tasks.
      </p>
    );
  }

  const fieldId = (name: string) => (task ? `${name}-${task.id}` : name);

  const courseOptions = courses.map((course) => ({
    value: course.id,
    label: course.code ? `${course.name} (${course.code})` : course.name,
  }));

  return (
    <form action={formAction} className="flex w-full flex-col">
      {task ? <input type="hidden" name="id" value={task.id} /> : null}
      {returnTo ? <input type="hidden" name="return_to" value={returnTo} /> : null}

      <ul className={dialogFormListClassName}>
        <DialogFormRow label="Title" htmlFor={fieldId("title")}>
          <Input
            id={fieldId("title")}
            name="title"
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            required
            aria-invalid={Boolean(state.fieldErrors?.title)}
            className={dialogInputClassName}
          />
        </DialogFormRow>

        {lockedCourseId ? (
          <input type="hidden" name="course_id" value={lockedCourseId} />
        ) : (
          <DialogFormRow label="Course" htmlFor={fieldId("course_id")}>
            <SelectMenu
              id={fieldId("course_id")}
              name="course_id"
              value={courseId}
              onChange={setCourseId}
              options={courseOptions}
              ariaLabel="Course"
              searchable
              aria-invalid={Boolean(state.fieldErrors?.course_id)}
            />
          </DialogFormRow>
        )}

        <DialogFormRow label="Deadline" htmlFor={fieldId("deadline")}>
          <Input
            id={fieldId("deadline")}
            name="deadline"
            type="datetime-local"
            value={deadline}
            onChange={(event) => setDeadline(event.target.value)}
            required
            aria-invalid={Boolean(state.fieldErrors?.deadline)}
            className={dialogInputClassName}
          />
        </DialogFormRow>

        <DialogFormRow label="Status" htmlFor={fieldId("status")}>
          <SelectMenu
            id={fieldId("status")}
            name="status"
            value={status}
            onChange={(value) => setStatus(value as TaskStatus)}
            options={STATUS_OPTIONS}
            ariaLabel="Status"
          />
        </DialogFormRow>

        <DialogFormRow label="Description" htmlFor={fieldId("description")}>
          <textarea
            id={fieldId("description")}
            name="description"
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            rows={3}
            className="w-full rounded-none border-0 bg-transparent px-0 py-1 font-sans text-[15px] font-normal leading-normal tracking-[-0.2px] text-ink shadow-none outline-none placeholder:text-ink-muted-48 focus-visible:border-0 focus-visible:ring-0 focus-visible:outline-none aria-invalid:text-destructive"
          />
        </DialogFormRow>

        <DialogFormRow
          label="Estimated duration"
          htmlFor={fieldId("estimated_duration")}
        >
          <Input
            id={fieldId("estimated_duration")}
            name="estimated_duration"
            type="number"
            min={1}
            step={1}
            inputMode="numeric"
            value={estimatedDuration}
            onChange={(event) => setEstimatedDuration(event.target.value)}
            aria-invalid={Boolean(state.fieldErrors?.estimated_duration)}
            className={dialogInputClassName}
          />
        </DialogFormRow>
      </ul>

      {state.error ? (
        <p className="pt-4 text-center text-sm text-destructive" role="alert">
          {state.error}
        </p>
      ) : null}

      <div className={dialogActionsClassName}>
        <Button
          type="submit"
          disabled={pending}
          className={dialogPrimaryActionClassName}
        >
          {pending ? "Saving…" : submitLabel}
        </Button>
        {onCancel ? (
          <Button
            type="button"
            variant="outline"
            onClick={onCancel}
            disabled={pending}
            className={dialogSecondaryActionClassName}
          >
            Cancel
          </Button>
        ) : null}
      </div>
    </form>
  );
}

/** Remounts on success so the create form clears without setState-in-effect. */
export function AddTaskForm({
  courses,
  lockedCourseId,
  returnTo,
  onCancel,
}: {
  courses: CourseListItem[];
  lockedCourseId?: string;
  returnTo?: string;
  onCancel?: () => void;
}) {
  const [formKey, setFormKey] = useState(0);
  return (
    <TaskForm
      key={formKey}
      courses={courses}
      lockedCourseId={lockedCourseId}
      returnTo={returnTo}
      submitLabel="Add task"
      onCancel={onCancel}
      onSuccess={() => setFormKey((current) => current + 1)}
    />
  );
}