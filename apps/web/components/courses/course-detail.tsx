"use client";

import Link from "next/link";
import { Check, Circle, MoreHorizontal, Pencil, Plus, Trash2 } from "lucide-react";
import {
  useActionState,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";

import {
  softDeleteCourse,
  type CourseActionState,
} from "@/app/actions/courses";
import { CourseForm } from "@/components/courses/course-form";
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
  formatCourseDetailSummaryLine,
  groupCourseTasks,
  summarizeCourseDetail,
  type CourseTask,
} from "@/lib/courses/course-tasks";
import { formatDeadline } from "@/lib/datetime";
import { formatRelativeDeadline } from "@/lib/deadline-relative";
import type { TaskStatus } from "@/lib/validation/task";
import { cn } from "@/lib/utils";
import type { CourseListItem } from "@/types/course";

const initialState: CourseActionState = {};

const STATUS_LABEL: Record<TaskStatus, string> = {
  todo: "To do",
  in_progress: "In progress",
  done: "Done",
};

type CourseDetailTask = CourseTask & {
  updated_at?: string;
};

type CourseDetailProps = {
  course: CourseListItem;
  tasks: CourseDetailTask[];
  timeZone: string;
};

type TaskGroupTone = "late" | "upcoming" | "done";

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
}: {
  course: CourseListItem;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [state, formAction, pending] = useActionState(
    softDeleteCourse,
    initialState,
  );

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
  tone,
}: {
  task: CourseDetailTask;
  timeZone: string;
  tone: TaskGroupTone;
}) {
  const completed = tone === "done";
  const relativeLabel = completed
    ? "Completed"
    : formatRelativeDeadline(task.deadline, timeZone);
  const completedAt = task.updated_at ?? task.deadline;
  const metaLine = completed
    ? `${STATUS_LABEL.done} · ${formatDeadline(completedAt, timeZone)}`
    : `${STATUS_LABEL[task.status]} · ${formatDeadline(task.deadline, timeZone)}`;

  const indicatorLabel =
    tone === "late" ? "Late" : tone === "upcoming" ? "Upcoming" : "Done";

  return (
    <li className="border-b border-hairline last:border-b-0">
      <Link
        href={`/tasks/${task.id}`}
        className="flex min-h-12 w-full items-start gap-3 py-3.5 outline-none transition-colors hover:bg-muted/40 focus-visible:bg-muted/40 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset sm:gap-3.5 sm:py-4"
      >
        <span className="mt-0.5 shrink-0" aria-hidden="true">
          {completed ? (
            <Check
              className="size-5 text-success"
              strokeWidth={2.25}
            />
          ) : (
            <Circle
              className={cn(
                "size-5",
                tone === "late" ? "text-destructive" : "text-warning",
              )}
              strokeWidth={2}
            />
          )}
        </span>
        <span className="sr-only">{indicatorLabel}. </span>
        <div className="min-w-0 flex-1 space-y-0.5">
          <p
            className={cn(
              "truncate text-[17px] font-medium leading-snug tracking-[-0.2px]",
              completed ? "text-ink-muted-80" : "text-ink",
            )}
          >
            {task.title}
          </p>
          <p className="truncate text-[13px] leading-snug text-ink-muted-48 sm:text-sm">
            {metaLine}
          </p>
        </div>
        <p
          className={cn(
            "shrink-0 pt-0.5 text-right text-[13px] leading-snug sm:text-sm",
            tone === "late"
              ? "text-destructive"
              : tone === "upcoming"
                ? "text-ink-muted-80"
                : "text-ink-muted-48",
          )}
        >
          {relativeLabel}
        </p>
        <span className="sr-only">Open {task.title}</span>
      </Link>
    </li>
  );
}

function CourseTaskGroup({
  title,
  tone,
  tasks,
  timeZone,
}: {
  title: string;
  tone: TaskGroupTone;
  tasks: CourseDetailTask[];
  timeZone: string;
}) {
  if (tasks.length === 0) return null;

  const titleClass =
    tone === "late"
      ? "text-destructive"
      : tone === "done"
        ? "text-ink-muted-48"
        : "text-warning";

  return (
    <section className="space-y-2" aria-label={title}>
      <h3
        className={cn(
          "font-display text-[13px] font-semibold tracking-[0.06em] uppercase sm:text-sm",
          titleClass,
        )}
      >
        {title}
      </h3>
      <ul className="list-none border-t border-hairline">
        {tasks.map((task) => (
          <CourseTaskRow
            key={task.id}
            task={task}
            timeZone={timeZone}
            tone={tone}
          />
        ))}
      </ul>
    </section>
  );
}

export function CourseDetail({ course, tasks, timeZone }: CourseDetailProps) {
  const [addOpen, setAddOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);

  const groups = useMemo(() => groupCourseTasks(tasks), [tasks]);
  const summaryLine = useMemo(
    () => formatCourseDetailSummaryLine(summarizeCourseDetail(tasks)),
    [tasks],
  );
  const fillColor = getCourseColorFill(course.color);
  const coursePath = `/courses/${course.id}`;
  const openAdd = () => setAddOpen(true);
  const openEdit = () => setEditOpen(true);

  return (
    <section className="mx-auto w-full max-w-3xl space-y-6 sm:space-y-8">
      <p className="text-sm">
        <Link
          href="/courses"
          className="text-primary hover:text-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          ‹ Courses
        </Link>
      </p>

      <header className="flex items-start justify-between gap-3 sm:gap-4">
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-start gap-3">
            <span
              aria-hidden
              className={cn(
                "mt-2.5 size-3.5 shrink-0 rounded-md border border-hairline sm:mt-3 sm:size-4",
                !fillColor && "bg-transparent",
              )}
              style={fillColor ? { backgroundColor: fillColor } : undefined}
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
        </div>

        <div className="mt-1 flex shrink-0 items-center gap-0.5 sm:mt-1.5 sm:gap-1">
          <Button
            type="button"
            variant="ghost"
            onClick={openEdit}
            className="min-h-11 gap-1.5 rounded-full px-3 text-ink"
          >
            <Pencil className="size-4" strokeWidth={2} aria-hidden="true" />
            Edit
          </Button>
          <CourseActionsMenu
            course={course}
            onEdit={openEdit}
            onDelete={() => setDeleteOpen(true)}
          />
        </div>
      </header>

      {summaryLine ? (
        <p className="text-sm text-ink-muted-48" aria-live="polite">
          {summaryLine}
        </p>
      ) : null}

      {tasks.length === 0 ? (
        <div className="space-y-6">
          <h2 className="font-display text-[19px] font-semibold tracking-[-0.2px] text-ink sm:text-[21px]">
            Tasks
          </h2>
          <div className="flex flex-col items-center px-2 py-10 text-center sm:px-4 sm:py-14">
            <h3 className="font-display text-xl font-semibold text-ink sm:text-[22px]">
              No tasks yet
            </h3>
            <p className="mt-2 max-w-sm text-[15px] leading-relaxed text-ink-muted-48">
              Add a task to start tracking deadlines for {course.name}.
            </p>
            <Button
              type="button"
              onClick={openAdd}
              className="mt-6 min-h-11 rounded-full px-5"
            >
              <Plus className="size-4" strokeWidth={2} aria-hidden="true" />
              Add task
            </Button>
          </div>
        </div>
      ) : (
        <div className="space-y-6 sm:space-y-8">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="font-display text-[19px] font-semibold tracking-[-0.2px] text-ink sm:text-[21px]">
              Tasks
            </h2>
            <Button
              type="button"
              onClick={openAdd}
              className="min-h-11 rounded-full px-5"
            >
              <Plus className="size-4" strokeWidth={2} aria-hidden="true" />
              Add task
            </Button>
          </div>

          <div className="space-y-8">
            <CourseTaskGroup
              title="Late"
              tone="late"
              tasks={groups.late}
              timeZone={timeZone}
            />
            <CourseTaskGroup
              title="Upcoming"
              tone="upcoming"
              tasks={groups.upcoming}
              timeZone={timeZone}
            />
            <CourseTaskGroup
              title="Done"
              tone="done"
              tasks={groups.done}
              timeZone={timeZone}
            />
          </div>

          <p className="pb-2 text-center text-sm text-ink-muted-48">
            That&apos;s all for now.
          </p>
        </div>
      )}

      <Dialog open={addOpen} onOpenChange={setAddOpen} title="Add task">
        <div className="w-full text-left">
          <AddTaskForm
            courses={[course]}
            lockedCourseId={course.id}
            returnTo={coursePath}
            onCancel={() => setAddOpen(false)}
          />
        </div>
      </Dialog>

      <Dialog open={editOpen} onOpenChange={setEditOpen} title="Edit course">
        <CourseForm
          course={course}
          submitLabel="Save changes"
          onCancel={() => setEditOpen(false)}
          onSuccess={() => setEditOpen(false)}
        />
      </Dialog>

      <DeleteCourseDialog
        course={course}
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
      />
    </section>
  );
}
