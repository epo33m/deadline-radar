"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { MoreHorizontal, Pencil, Plus, Trash2 } from "lucide-react";
import {
  useActionState,
  useEffect,
  useId,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";

import {
  softDeleteCourse,
  type CourseActionState,
} from "@/app/actions/courses";
import { CourseForm } from "@/components/courses/course-form";
import { StatusPill } from "@/components/dashboard/status-pill";
import { AddTaskForm } from "@/components/tasks/task-form";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  dialogActionsClassName,
  dialogPrimaryActionClassName,
  dialogSecondaryActionClassName,
} from "@/components/ui/dialog";
import { getCourseColorFill } from "@/lib/courses/colors";
import {
  orderCourseTasks,
  summarizeCourseTasks,
  type CourseTaskSummary,
} from "@/lib/courses/course-tasks";
import { formatDeadline } from "@/lib/datetime";
import { formatRelativeDeadline } from "@/lib/dashboard/deadline-relative";
import type { TaskStatus } from "@/lib/validation/task";
import { cn } from "@/lib/utils";
import type { CourseListItem } from "@/types/course";
import type { TaskListItem } from "@/types/task";

const initialState: CourseActionState = {};

const STATUS_LABEL: Record<TaskStatus, string> = {
  todo: "To do",
  in_progress: "In progress",
  done: "Done",
};

type CourseDetailProps = {
  course: CourseListItem;
  tasks: TaskListItem[];
  timeZone: string;
};

type ActionsMenuPosition = {
  top: number;
  left: number;
  minWidth: number;
};

function measureActionsMenuPosition(
  trigger: HTMLButtonElement,
): ActionsMenuPosition {
  const rect = trigger.getBoundingClientRect();
  const minWidth = 160;
  const margin = 8;
  const left = Math.min(
    Math.max(margin, rect.right - minWidth),
    window.innerWidth - minWidth - margin,
  );

  return {
    top: rect.bottom + 4,
    left,
    minWidth,
  };
}

function CourseActionsMenu({
  course,
  onEdit,
  onDelete,
}: {
  course: CourseListItem;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const menuId = useId();
  const containerRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const editRef = useRef<HTMLButtonElement>(null);
  const deleteRef = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const [menuPosition, setMenuPosition] = useState<ActionsMenuPosition | null>(
    null,
  );

  useEffect(() => {
    if (!open || !triggerRef.current) {
      setMenuPosition(null);
      return;
    }

    function updatePosition() {
      if (!triggerRef.current) return;
      setMenuPosition(measureActionsMenuPosition(triggerRef.current));
    }

    updatePosition();
    window.addEventListener("resize", updatePosition);
    window.addEventListener("scroll", updatePosition, true);
    return () => {
      window.removeEventListener("resize", updatePosition);
      window.removeEventListener("scroll", updatePosition, true);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;

    function onPointerDown(event: MouseEvent) {
      const target = event.target as Node;
      if (
        containerRef.current?.contains(target) ||
        menuRef.current?.contains(target)
      ) {
        return;
      }
      setOpen(false);
    }

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setOpen(false);
        triggerRef.current?.focus();
        return;
      }
      if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
      event.preventDefault();
      const items = [editRef.current, deleteRef.current].filter(Boolean);
      const index = items.indexOf(document.activeElement as HTMLButtonElement);
      const next =
        event.key === "ArrowDown"
          ? items[(index + 1) % items.length]
          : items[(index - 1 + items.length) % items.length];
      next?.focus();
    }

    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    queueMicrotask(() => editRef.current?.focus());
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  const menu =
    open && menuPosition
      ? createPortal(
          <div
            ref={menuRef}
            id={menuId}
            role="menu"
            aria-label={`Actions for ${course.name}`}
            style={{
              position: "fixed",
              top: menuPosition.top,
              left: menuPosition.left,
              minWidth: menuPosition.minWidth,
            }}
            className="z-50 rounded-xl border border-hairline bg-canvas p-1 shadow-lg"
          >
            <button
              ref={editRef}
              type="button"
              role="menuitem"
              onClick={() => {
                setOpen(false);
                onEdit();
              }}
              className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-sm text-ink hover:bg-muted focus-visible:bg-muted focus-visible:outline-none"
            >
              <Pencil className="size-4 text-ink-muted-48" aria-hidden="true" />
              Edit course
            </button>
            <button
              ref={deleteRef}
              type="button"
              role="menuitem"
              onClick={() => {
                setOpen(false);
                onDelete();
              }}
              className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-sm text-destructive hover:bg-destructive/10 focus-visible:bg-destructive/10 focus-visible:outline-none"
            >
              <Trash2 className="size-4" aria-hidden="true" />
              Delete course
            </button>
          </div>,
          document.body,
        )
      : null;

  return (
    <div ref={containerRef} className="relative shrink-0">
      <button
        ref={triggerRef}
        type="button"
        aria-expanded={open}
        aria-haspopup="menu"
        aria-controls={menuId}
        aria-label={`Actions for ${course.name}`}
        onClick={() => setOpen((current) => !current)}
        className="inline-flex size-11 shrink-0 items-center justify-center rounded-full text-ink hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <MoreHorizontal className="size-4" aria-hidden="true" strokeWidth={2.25} />
      </button>
      {menu}
    </div>
  );
}

function DeleteCourseDialog({
  course,
  open,
  onOpenChange,
  onDeleted,
}: {
  course: CourseListItem;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onDeleted?: () => void;
}) {
  const [state, formAction, pending] = useActionState(
    softDeleteCourse,
    initialState,
  );

  const wasPending = useRef(false);
  useEffect(() => {
    if (wasPending.current && !pending && !state.error) {
      onOpenChange(false);
      onDeleted?.();
    }
    wasPending.current = pending;
  }, [pending, state.error, onOpenChange, onDeleted]);

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title="Delete course"
      dismissible={!pending}
    >
      <div className="flex w-full flex-col">
        <p className="text-[15px] leading-relaxed text-ink">
          Are you sure you want to delete &ldquo;{course.name}&rdquo;?
        </p>
        <p className="pt-2 text-sm leading-relaxed text-ink-muted-48">
          This will permanently remove the course from your list. You cannot
          restore it from the Courses page.
        </p>

        {state.error ? (
          <p className="pt-4 text-center text-sm text-destructive" role="alert">
            {state.error}
          </p>
        ) : null}

        <form action={formAction} className={dialogActionsClassName}>
          <input type="hidden" name="id" value={course.id} />
          <Button
            type="submit"
            disabled={pending}
            className={`${dialogPrimaryActionClassName} bg-destructive text-white hover:bg-destructive/90`}
          >
            {pending ? "Deleting…" : "Delete"}
          </Button>
          <Button
            type="button"
            variant="outline"
            disabled={pending}
            onClick={() => onOpenChange(false)}
            className={dialogSecondaryActionClassName}
          >
            Cancel
          </Button>
        </form>
      </div>
    </Dialog>
  );
}

function CourseTaskRow({
  task,
  timeZone,
}: {
  task: TaskListItem;
  timeZone: string;
}) {
  const relativeLabel =
    task.status === "done"
      ? null
      : formatRelativeDeadline(task.deadline, timeZone);

  return (
    <li className="border-b border-hairline py-4 last:border-b-0">
      <div className="flex min-w-0 flex-col gap-2 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
        <div className="min-w-0 space-y-1">
          <Link
            href={`/tasks/${task.id}`}
            className="font-medium text-ink hover:text-primary focus-visible:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-focus"
          >
            {task.title}
          </Link>
          <p className="text-sm text-ink-muted-48">
            Due {formatDeadline(task.deadline, timeZone)} ·{" "}
            {STATUS_LABEL[task.status]}
          </p>
        </div>
        {relativeLabel ? (
          <StatusPill
            className="self-start sm:shrink-0"
            tone={relativeLabel.includes("overdue") ? "overdue" : "due-soon"}
          >
            {relativeLabel}
          </StatusPill>
        ) : task.status === "done" ? (
          <StatusPill tone="completed" className="self-start sm:shrink-0">
            Done
          </StatusPill>
        ) : null}
      </div>
    </li>
  );
}

function formatSummaryLine(summary: CourseTaskSummary): string | null {
  const parts: string[] = [];
  if (summary.overdue > 0) {
    parts.push(`${summary.overdue} overdue`);
  }
  if (summary.dueThisWeek > 0) {
    parts.push(`${summary.dueThisWeek} due this week`);
  }
  if (summary.completed > 0) {
    parts.push(`${summary.completed} completed`);
  }
  return parts.length > 0 ? parts.join(" · ") : null;
}

export function CourseDetail({ course, tasks, timeZone }: CourseDetailProps) {
  const router = useRouter();
  const [addOpen, setAddOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);

  const ordered = orderCourseTasks(tasks);
  const active = ordered.filter((task) => task.status !== "done");
  const completed = ordered.filter((task) => task.status === "done");
  const summaryLine = formatSummaryLine(summarizeCourseTasks(tasks));
  const fillColor = getCourseColorFill(course.color);
  const coursePath = `/courses/${course.id}`;

  return (
    <section className="space-y-6 sm:space-y-8">
      <p className="text-sm">
        <Link
          href="/courses"
          className="text-ink-muted-48 hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          ← Courses
        </Link>
      </p>

      <header className="flex items-start justify-between gap-3 sm:gap-4">
        <div className="min-w-0 flex-1 space-y-2 sm:space-y-3">
          <div className="flex min-w-0 items-start gap-3">
            <span
              aria-hidden
              className={cn(
                "mt-2 size-3 shrink-0 rounded-full border border-hairline",
                !fillColor && "bg-transparent",
              )}
              style={
                fillColor ? { backgroundColor: fillColor } : undefined
              }
            />
            <div className="min-w-0 space-y-1">
              <h1 className="font-display text-[32px] font-semibold leading-[1.07] tracking-[-0.28px] text-ink sm:text-[36px] lg:text-[44px]">
                {course.name}
              </h1>
              {course.code ? (
                <p className="text-[15px] text-ink-muted-48 sm:text-[17px]">
                  {course.code}
                </p>
              ) : null}
            </div>
          </div>
          <p className="max-w-xl text-[15px] font-normal leading-[1.47] tracking-[-0.374px] text-ink-muted-48 sm:text-[17px]">
            Organize and track coursework for this course.
          </p>
        </div>

        <CourseActionsMenu
          course={course}
          onEdit={() => setEditOpen(true)}
          onDelete={() => setDeleteOpen(true)}
        />
      </header>

      <div className="flex flex-wrap items-center gap-3">
        <Button
          type="button"
          onClick={() => setAddOpen(true)}
          className="min-h-11 rounded-full px-5"
        >
          <Plus className="size-4" strokeWidth={2} aria-hidden="true" />
          Add task
        </Button>
        {summaryLine ? (
          <p className="text-sm text-ink-muted-48" aria-live="polite">
            {summaryLine}
          </p>
        ) : null}
      </div>

      {ordered.length === 0 ? (
        <div className="flex min-h-[min(20rem,calc(100svh-18rem))] flex-col items-center justify-center px-2 py-12 text-center sm:px-4">
          <h2 className="font-display text-xl font-semibold text-ink sm:text-[22px]">
            No tasks yet
          </h2>
          <p className="mt-2 max-w-sm text-[15px] leading-relaxed text-ink-muted-48">
            Add a task to track deadlines and reminders for this course.
          </p>
          <Button
            type="button"
            onClick={() => setAddOpen(true)}
            className="mt-6 min-h-11 rounded-full px-5"
          >
            <Plus className="size-4" strokeWidth={2} aria-hidden="true" />
            Add task
          </Button>
        </div>
      ) : (
        <div className="space-y-8">
          <div className="space-y-3">
            <h2 className="font-display text-[19px] font-semibold tracking-[-0.2px] text-ink sm:text-[21px]">
              Tasks
            </h2>
            {active.length === 0 ? (
              <p className="text-sm text-ink-muted-48">
                No active tasks. Completed work is listed below.
              </p>
            ) : (
              <ul className="border-t border-hairline">
                {active.map((task) => (
                  <CourseTaskRow
                    key={task.id}
                    task={task}
                    timeZone={timeZone}
                  />
                ))}
              </ul>
            )}
          </div>

          {completed.length > 0 ? (
            <div className="space-y-3">
              <h2 className="font-display text-[19px] font-semibold tracking-[-0.2px] text-ink-muted-48 sm:text-[21px]">
                Completed
              </h2>
              <ul className="border-t border-hairline opacity-80">
                {completed.map((task) => (
                  <CourseTaskRow
                    key={task.id}
                    task={task}
                    timeZone={timeZone}
                  />
                ))}
              </ul>
            </div>
          ) : null}
        </div>
      )}

      <Dialog open={addOpen} onOpenChange={setAddOpen} title="Add task">
        <div className="w-full text-left">
          <AddTaskForm
            courses={[course]}
            lockedCourseId={course.id}
            returnTo={coursePath}
          />
        </div>
      </Dialog>

      <Dialog
        open={editOpen}
        onOpenChange={setEditOpen}
        title="Edit course"
      >
        <CourseForm
          course={course}
          submitLabel="Save changes"
          namePlaceholder="Edit course"
          onCancel={() => setEditOpen(false)}
          onSuccess={() => setEditOpen(false)}
        />
      </Dialog>

      <DeleteCourseDialog
        course={course}
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        onDeleted={() => router.push("/courses")}
      />
    </section>
  );
}
