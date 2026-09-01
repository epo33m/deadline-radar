"use client";

import { useActionState, useEffect, useRef, useState } from "react";

import {
  createTask,
  updateTask,
  type TaskActionState,
} from "@/app/actions/tasks";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
  submitLabel: string;
  defaultStatus?: TaskStatus;
};

export function TaskForm({
  task,
  courses,
  onSuccess,
  submitLabel,
  defaultStatus = "todo",
}: TaskFormProps) {
  const action = task ? updateTask : createTask;
  const [state, formAction, pending] = useActionState(action, initialState);
  const [title, setTitle] = useState(task?.title ?? "");
  const [courseId, setCourseId] = useState(
    task?.course_id ?? courses[0]?.id ?? "",
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

  return (
    <form action={formAction} className="flex max-w-lg flex-col gap-4">
      {task ? <input type="hidden" name="id" value={task.id} /> : null}
      <div className="space-y-2">
        <Label htmlFor={fieldId("title")}>Title</Label>
        <Input
          id={fieldId("title")}
          name="title"
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          required
          aria-invalid={Boolean(state.fieldErrors?.title)}
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor={fieldId("course_id")}>Course</Label>
        <select
          id={fieldId("course_id")}
          name="course_id"
          value={courseId}
          onChange={(event) => setCourseId(event.target.value)}
          required
          className="flex h-9 w-full rounded-md border border-hairline bg-canvas px-3 text-sm text-ink outline-none focus-visible:border-primary"
          aria-invalid={Boolean(state.fieldErrors?.course_id)}
        >
          {courses.map((course) => (
            <option key={course.id} value={course.id}>
              {course.name}
              {course.code ? ` (${course.code})` : ""}
            </option>
          ))}
        </select>
      </div>
      <div className="space-y-2">
        <Label htmlFor={fieldId("deadline")}>Deadline</Label>
        <Input
          id={fieldId("deadline")}
          name="deadline"
          type="datetime-local"
          value={deadline}
          onChange={(event) => setDeadline(event.target.value)}
          required
          aria-invalid={Boolean(state.fieldErrors?.deadline)}
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor={fieldId("status")}>Status</Label>
        <select
          id={fieldId("status")}
          name="status"
          value={status}
          onChange={(event) => setStatus(event.target.value as TaskStatus)}
          className="flex h-9 w-full rounded-md border border-hairline bg-canvas px-3 text-sm text-ink outline-none focus-visible:border-primary"
        >
          {STATUS_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </div>
      <div className="space-y-2">
        <Label htmlFor={fieldId("description")}>
          Description <span className="text-ink-muted-48">(optional)</span>
        </Label>
        <textarea
          id={fieldId("description")}
          name="description"
          value={description}
          onChange={(event) => setDescription(event.target.value)}
          rows={3}
          className="flex w-full rounded-md border border-hairline bg-canvas px-3 py-2 text-sm text-ink outline-none focus-visible:border-primary"
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor={fieldId("estimated_duration")}>
          Estimated duration{" "}
          <span className="text-ink-muted-48">(optional minutes)</span>
        </Label>
        <Input
          id={fieldId("estimated_duration")}
          name="estimated_duration"
          type="number"
          min={1}
          step={1}
          inputMode="numeric"
          value={estimatedDuration}
          onChange={(event) => setEstimatedDuration(event.target.value)}
          placeholder="90"
          aria-invalid={Boolean(state.fieldErrors?.estimated_duration)}
        />
      </div>
      <Button type="submit" disabled={pending}>
        {pending ? "Saving…" : submitLabel}
      </Button>
      {state.error ? (
        <p className="text-sm text-destructive" role="alert">
          {state.error}
        </p>
      ) : null}
    </form>
  );
}

/** Remounts on success so the create form clears without setState-in-effect. */
export function AddTaskForm({ courses }: { courses: CourseListItem[] }) {
  const [formKey, setFormKey] = useState(0);
  return (
    <TaskForm
      key={formKey}
      courses={courses}
      submitLabel="Add task"
      onSuccess={() => setFormKey((current) => current + 1)}
    />
  );
}
