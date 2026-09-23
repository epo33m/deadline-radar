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
  formCardClassName,
  formSectionGapClassName,
} from "@/components/ui/dialog-form";
import { Input } from "@/components/ui/input";
import { SelectMenu } from "@/components/ui/select-menu";
import { StatusPicker } from "@/components/tasks/status-picker";
import { generateIdempotencyKey } from "@/lib/api/idempotency";
import { toDatetimeLocalValue } from "@/lib/datetime";
import { cn } from "@/lib/utils";
import type { TaskStatus } from "@/lib/validation/task";
import type { CourseListItem } from "@/types/course";
import type { TaskListItem } from "@/types/task";

const initialState: TaskActionState = {};

function splitDateTime(value: string): { date: string; time: string } {
  const [date = "", time = ""] = value.split("T");
  return { date, time };
}

function pad(value: number): string {
  return String(value).padStart(2, "0");
}

/** Today's local date as YYYY-MM-DD (matches the native date input format). */
function todayLocalISO(): string {
  const now = new Date();
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

/** Current local time as HH:mm. */
function currentTime(): string {
  const now = new Date();
  return `${pad(now.getHours())}:${pad(now.getMinutes())}`;
}

/** Round the current time to the nearest half hour, as HH:mm. */
function defaultTime(): string {
  const now = new Date();
  const hour = now.getHours();
  const minute = now.getMinutes() >= 30 ? 30 : 0;
  const nextHour = minute === 0 && now.getMinutes() > 0 ? hour + 1 : hour;
  return `${pad(nextHour % 24)}:${pad(minute)}`;
}

type TaskFormProps = {
  task?: Pick<
    TaskListItem,
    | "id"
    | "title"
    | "course_id"
    | "deadline"
    | "status"
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
  const [idempotencyKey] = useState(() => generateIdempotencyKey());
  const [state, formAction, pending] = useActionState(action, initialState);
  const [title, setTitle] = useState(task?.title ?? "");
  const [courseId, setCourseId] = useState(
    lockedCourseId ?? task?.course_id ?? courses[0]?.id ?? "",
  );
  const [deadlineDate, setDeadlineDate] = useState(
    task
      ? splitDateTime(task.deadline ? toDatetimeLocalValue(task.deadline) : "").date
      : todayLocalISO(),
  );
  const [deadlineTime, setDeadlineTime] = useState(
    task
      ? splitDateTime(task.deadline ? toDatetimeLocalValue(task.deadline) : "").time
      : currentTime(),
  );
  const [status, setStatus] = useState<TaskStatus>(task?.status ?? defaultStatus);
  const [description, setDescription] = useState(task?.description ?? "");
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

  const deadline = deadlineDate ? `${deadlineDate}T${deadlineTime || defaultTime()}` : "";

  function setDate(nextDate: string) {
    setDeadlineDate(nextDate);
    setDeadlineTime((current) => (nextDate ? current || defaultTime() : ""));
  }

  const courseOptions = courses.map((course) => ({
    value: course.id,
    label: course.code ? `(${course.code}) ${course.name}` : course.name,
  }));

  return (
    <form action={formAction} className="flex w-full flex-col">
      {task ? (
        <input type="hidden" name="id" value={task.id} />
      ) : (
        <input type="hidden" name="idempotency_key" value={idempotencyKey} />
      )}
      {returnTo ? <input type="hidden" name="return_to" value={returnTo} /> : null}
      <input type="hidden" name="deadline" value={deadline} />

      <div className={cn("w-full", formSectionGapClassName)}>
        {lockedCourseId ? (
          <input type="hidden" name="course_id" value={lockedCourseId} />
        ) : (
          <ul className={cn("w-full list-none divide-y divide-divider-soft", formCardClassName)}>
            <DialogFormRow label="Course" htmlFor={fieldId("course_id")}>
              <div className="flex justify-end">
                <SelectMenu
                  id={fieldId("course_id")}
                  name="course_id"
                  value={courseId}
                  onChange={setCourseId}
                  options={courseOptions}
                  ariaLabel="Course"
                  searchable
                  compact
                  aria-invalid={Boolean(state.fieldErrors?.course_id)}
                />
              </div>
            </DialogFormRow>
          </ul>
        )}

        <ul className={dialogFormListClassName}>
          <li className="py-1.5">
            <Input
              id={fieldId("title")}
              name="title"
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              placeholder="Title"
              required
              aria-invalid={Boolean(state.fieldErrors?.title)}
              className={cn(dialogInputClassName, "text-left")}
            />
          </li>

          <li className="py-1.5">
            <textarea
              id={fieldId("description")}
              name="description"
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              placeholder="Description"
              rows={3}
              aria-invalid={Boolean(state.fieldErrors?.description)}
              className="w-full rounded-none border-0 bg-transparent px-0 py-1 font-sans text-[15px] font-normal leading-normal tracking-[-0.2px] text-ink shadow-none outline-none placeholder:text-ink-muted-48 focus-visible:border-0 focus-visible:ring-0 focus-visible:outline-none aria-invalid:text-destructive"
            />
          </li>
        </ul>

        <ul className={cn("w-full list-none divide-y divide-divider-soft", formCardClassName)}>
          <DialogFormRow label="Date" htmlFor={fieldId("deadline_date")}>
            <div className="flex justify-end">
              <label className="flex h-7 w-fit shrink-0 cursor-pointer items-center justify-center rounded-md border border-hairline bg-canvas px-1.5 text-ink-muted-80 transition-colors has-focus-visible:ring-2 has-focus-visible:ring-ring/50 hover:bg-muted">
                <input
                  id={fieldId("deadline_date")}
                  type="date"
                  value={deadlineDate}
                  onChange={(event) => setDate(event.target.value)}
                  className="w-21 bg-transparent px-0 text-center text-[13px] leading-none text-ink outline-none appearance-none [&::-webkit-calendar-picker-indicator]:absolute [&::-webkit-calendar-picker-indicator]:inset-0 [&::-webkit-calendar-picker-indicator]:w-full [&::-webkit-calendar-picker-indicator]:cursor-pointer [&::-webkit-calendar-picker-indicator]:opacity-0 placeholder:text-ink-muted-48"
                />
              </label>
            </div>
          </DialogFormRow>

          <DialogFormRow label="Time" htmlFor={fieldId("deadline_time")}>
            <div className="flex justify-end">
              <label className="flex h-7 w-fit shrink-0 cursor-pointer items-center justify-center rounded-md border border-hairline bg-canvas px-1.5 text-ink-muted-80 transition-colors has-focus-visible:ring-2 has-focus-visible:ring-ring/50 hover:bg-muted">
                <input
                  id={fieldId("deadline_time")}
                  type="time"
                  step={600}
                  value={deadlineTime}
                  onChange={(event) => setDeadlineTime(event.target.value)}
                  className="w-15 bg-transparent px-0 text-center text-[13px] leading-none text-ink outline-none appearance-none [&::-webkit-calendar-picker-indicator]:absolute [&::-webkit-calendar-picker-indicator]:inset-0 [&::-webkit-calendar-picker-indicator]:w-full [&::-webkit-calendar-picker-indicator]:cursor-pointer [&::-webkit-calendar-picker-indicator]:opacity-0 [&::-webkit-timepicker-indicator]:opacity-0 [&::-webkit-date-and-time-value]:m-0 [&::-webkit-date-and-time-value]:flex [&::-webkit-date-and-time-value]:w-full [&::-webkit-date-and-time-value]:justify-center placeholder:text-ink-muted-48"
                />
              </label>
            </div>
          </DialogFormRow>
        </ul>

        <ul className={cn("w-full list-none divide-y divide-divider-soft", formCardClassName)}>
          <DialogFormRow label="Status" htmlFor={fieldId("status")}>
            <input type="hidden" name="status" value={status} />
            <StatusPicker
              id={fieldId("status")}
              value={status}
              onChange={setStatus}
            />
          </DialogFormRow>
        </ul>
      </div>

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