"use client";

import Link from "next/link";
import {
  Calendar,
  Check,
  CheckCircle2,
  ChevronRight,
  Circle,
  ClockAlert,
  Pencil,
  Plus,
  Trash2,
  X,
  type LucideIcon,
} from "lucide-react";
import { useActionState, useMemo, useState } from "react";
import type { TimeFormat } from "@deadline-radar/validation";
import { useNow } from "@/lib/use-now";

import {
  softDeleteCourse,
  type CourseActionState,
} from "@/app/actions/courses";
import { CourseForm } from "@/components/courses/course-form";
import { AddTaskForm } from "@/components/tasks/task-form";
import { Button } from "@/components/ui/button";
import { LearnSecondaryNav } from "@/components/learn/learn-secondary-nav";
import {
  Dialog,
  dialogActionsClassName,
  dialogPrimaryActionClassName,
  dialogSecondaryActionClassName,
} from "@/components/ui/dialog";
import { getCourseColorFill, getCourseColorLabel } from "@/lib/courses/colors";
import { CourseIconView } from "@/components/courses/course-icon";
import { getCourseIconLabel } from "@/lib/courses/icons";
import {
  groupCourseTasks,
  type CourseTask,
  type CourseTaskGroups,
} from "@/lib/courses/course-tasks";
import {
  formatDeadline,
  formatDeadlineDate,
  formatDeadlineTime,
} from "@/lib/datetime";
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

type CourseTaskView = "all" | "upcoming" | "overdue" | "done";

type CourseDetailProps = {
  course: CourseListItem;
  tasks: CourseDetailTask[];
  timeZone: string;
  timeFormat: TimeFormat;
  taskView: CourseTaskView;
  nowIso?: string;
};

type TaskGroupTone = "late" | "upcoming" | "done" | "neutral";

type CourseView = "about" | "task";

type CourseTaskViewChild = {
  id: Exclude<CourseTaskView, "all">;
  label: string;
  icon: LucideIcon;
};

const COURSE_VIEWS: { id: CourseView; label: string; children?: CourseTaskViewChild[] }[] = [
  {
    id: "task",
    label: "Task",
    children: [
      { id: "upcoming", label: "Upcoming", icon: Calendar },
      { id: "overdue", label: "Overdue", icon: ClockAlert },
      { id: "done", label: "Done", icon: CheckCircle2 },
    ],
  },
  { id: "about", label: "About" },
];



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
  timeFormat,
  now,
  tone,
  dateOnRight = false,
  bare = false,
}: {
  task: CourseDetailTask;
  timeZone: string;
  timeFormat: TimeFormat;
  now: Date;
  tone: TaskGroupTone;
  dateOnRight?: boolean;
  bare?: boolean;
}) {
  const completed = tone === "done";
  const relativeLabel = completed
    ? "Completed"
    : formatRelativeDeadline(task.deadline, timeZone, now);
  const completedAt = task.updated_at ?? task.deadline;
  const metaLine = completed
    ? `${STATUS_LABEL.done} · ${formatDeadline(completedAt, timeZone, timeFormat)}`
    : dateOnRight
      ? `${STATUS_LABEL[task.status]} · ${formatDeadlineTime(task.deadline, timeZone, timeFormat)}`
      : `${STATUS_LABEL[task.status]} · ${formatDeadline(task.deadline, timeZone, timeFormat)}`;
  const rightLabel =
    dateOnRight && !completed
      ? bare
        ? formatDeadlineDate(task.deadline, timeZone)
        : formatRelativeDeadline(task.deadline, timeZone, now)
      : relativeLabel;

  const indicatorLabel =
    tone === "late" ? "Late" : tone === "upcoming" ? "Upcoming" : "Done";

  return (
    <li>
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
                tone === "late" ? "text-destructive" : tone === "neutral" ? "text-ink-muted-48" : "text-warning",
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
            dateOnRight && !completed
              ? tone === "late"
                ? "text-destructive"
                : tone === "neutral"
                  ? "text-ink-muted-48"
                  : "text-warning"
              : tone === "late"
                ? "text-destructive"
                : tone === "upcoming"
                  ? "text-ink-muted-80"
                  : "text-ink-muted-48",
          )}
        >
          {rightLabel}
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
  timeFormat,
  now,
  dateOnRight = false,
  bare = false,
}: {
  title: string;
  tone: TaskGroupTone;
  tasks: CourseDetailTask[];
  timeZone: string;
  timeFormat: TimeFormat;
  now: Date;
  dateOnRight?: boolean;
  bare?: boolean;
}) {
  if (tasks.length === 0) return null;

  const titleClass =
    tone === "late"
      ? "text-destructive"
      : tone === "done"
        ? "text-ink-muted-48"
        : tone === "neutral"
          ? "text-ink-muted-64"
          : "text-warning";

  return (
    <section className="space-y-2" aria-label={title}>
      {bare ? null : (
        <h3
          className={cn(
            "font-display text-[13px] font-semibold tracking-[0.06em] uppercase sm:text-sm",
            titleClass,
          )}
        >
          {title}
        </h3>
      )}
      <ul className="list-none">
        {tasks.map((task) => (
          <CourseTaskRow
            key={task.id}
            task={task}
            timeZone={timeZone}
            timeFormat={timeFormat}
            now={now}
            tone={tone}
            dateOnRight={dateOnRight}
            bare={bare}
          />
        ))}
      </ul>
    </section>
  );
}

type CourseTaskCardTone = "upcoming" | "overdue" | "done";

const TASK_CARD_CONFIG: {
  id: CourseTaskCardTone;
  label: string;
  icon: LucideIcon;
  toneClass: string;
  cardClass?: string;
}[] = [
  { id: "upcoming", label: "Upcoming", icon: Calendar, toneClass: "text-white", cardClass: "bg-gradient-to-br from-[#FFEA56] to-[#FFB32E] border-transparent" },
  { id: "overdue", label: "Overdue", icon: ClockAlert, toneClass: "text-white", cardClass: "bg-gradient-to-br from-[#FFA06B] to-[#E9628B] border-transparent" },
  { id: "done", label: "Done", icon: CheckCircle2, toneClass: "text-white", cardClass: "bg-gradient-to-br from-[#4edfc2] to-[#a4ed63] border-transparent" },
];

function CourseTaskSummaryCards({
  counts,
  coursePath,
}: {
  counts: Record<CourseTaskCardTone, number>;
  coursePath: string;
}) {
  return (
    <div className="grid grid-cols-3 gap-3 sm:gap-4">
      {TASK_CARD_CONFIG.map((card) => {
        return (
          <Link
            key={card.id}
            href={`${coursePath}?view=${card.id}`}
            className={cn(
              "inline-flex items-center justify-between gap-2 rounded-full border px-3 py-1.5 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-focus sm:px-4 sm:py-2",
              card.cardClass ?? "border-hairline bg-canvas hover:border-ink/20",
            )}
          >
            <span className={cn("text-sm font-bold sm:text-base", card.cardClass ? "text-white" : "text-ink-muted-80")}>
              {card.label}
            </span>
            <span
              className={cn(
                "font-display text-xl font-black tabular-nums sm:text-2xl",
                card.toneClass,
              )}
            >
              {counts[card.id]}
            </span>
          </Link>
        );
      })}
    </div>
  );
}

function CourseSidebarNav({
  view,
  taskView,
  coursePath,
  onChange,
  onDelete,
  onNavigate,
  className,
}: {
  view: CourseView;
  taskView: CourseTaskView;
  coursePath: string;
  onChange: (view: CourseView) => void;
  onDelete: () => void;
  onNavigate?: () => void;
  className?: string;
}) {
  const [taskExpanded, setTaskExpanded] = useState(taskView !== "all");
  const [prevTaskView, setPrevTaskView] = useState(taskView);
  if (prevTaskView !== taskView) {
    setPrevTaskView(taskView);
    if (taskView !== "all") {
      setTaskExpanded(true);
    }
  }

  const itemClassName = (selected: boolean) =>
    cn(
      "flex w-full items-center rounded-sm px-2 py-2 text-left text-[17px] leading-tight tracking-[-0.374px] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-focus",
      selected
        ? "bg-muted font-semibold text-ink"
        : "text-ink-muted-80 hover:bg-muted/60 hover:text-ink",
    );

  return (
    <nav
      aria-label="Course sections"
      className={cn("min-w-0", className)}
    >
      <ul className="flex flex-col space-y-3">
        {COURSE_VIEWS.map((item) => {
          const hasChildren = item.children && item.children.length > 0;
          const selected =
            view === item.id && (!hasChildren || taskView === "all");
          const isExpanded = item.id === "task" && taskExpanded;

          return (
            <li key={item.id}>
              {hasChildren ? (
                <div className={itemClassName(selected)}>
                  <Link
                    href={coursePath}
                    aria-current={selected ? "page" : undefined}
                    onClick={() => {
                      setTaskExpanded(true);
                      onChange(item.id);
                      onNavigate?.();
                    }}
                    className="flex-1 outline-none focus-visible:ring-2 focus-visible:ring-primary-focus"
                  >
                    {item.label}
                  </Link>
                  <button
                    type="button"
                    aria-label={isExpanded ? "Collapse tasks" : "Expand tasks"}
                    aria-expanded={isExpanded}
                    onClick={() => setTaskExpanded(!isExpanded)}
                    className="inline-flex size-8 shrink-0 items-center justify-center rounded-sm text-ink-muted-80 transition-colors hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-focus"
                  >
                    <ChevronRight
                      className={cn(
                        "size-4 transition-transform",
                        isExpanded && "rotate-90",
                      )}
                      strokeWidth={2}
                      aria-hidden="true"
                    />
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  aria-pressed={selected}
                  onClick={() => onChange(item.id)}
                  className={itemClassName(selected)}
                >
                  {item.label}
                </button>
              )}

              {hasChildren && isExpanded && (
                <ul className="mt-1 ml-4 flex flex-col space-y-3">
                  {item.children!.map((child) => {
                    const childActive =
                      view === item.id && taskView === child.id;
                    const ChildIcon = child.icon;
                    return (
                      <li key={child.id}>
                        <Link
                          href={`${coursePath}?view=${child.id}`}
                          aria-current={childActive ? "page" : undefined}
                          onClick={() => {
                            onChange(item.id);
                            onNavigate?.();
                          }}
                          className={cn(
                            "flex w-full items-center gap-2 rounded-sm px-2 py-2 text-left text-[17px] leading-tight tracking-[-0.374px] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-focus",
                            childActive
                              ? "bg-muted font-semibold text-ink"
                              : "text-ink-muted-80 hover:bg-muted/60 hover:text-ink",
                          )}
                        >
                          <ChildIcon
                            className="size-4 shrink-0"
                            strokeWidth={2}
                            aria-hidden="true"
                          />
                          {child.label}
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              )}
            </li>
          );
        })}
      </ul>

      <div className="mt-5 border-t border-hairline pt-3">
        <button
          type="button"
          onClick={onDelete}
          className="flex w-full items-center gap-2 rounded-sm px-2 py-2 text-left text-[17px] leading-tight tracking-[-0.374px] text-destructive transition-colors hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-focus"
        >
          <Trash2 className="size-4" strokeWidth={2} aria-hidden="true" />
          Delete course
        </button>
      </div>
    </nav>
  );
}

function MobileCourseDescriptionRow({
  description,
}: {
  description: string | null;
}) {
  const [expanded, setExpanded] = useState(false);
  const MAX_CHARS = 300;
  const SHOW_MORE_THRESHOLD = 15;
  const labelClassName =
    "shrink-0 text-[15px] font-medium leading-relaxed text-ink-muted-48 sm:text-[17px]";
  const toggleClassName =
    "shrink-0 text-sm font-medium text-primary hover:underline focus-visible:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

  if (!description) {
    return (
      <li className="flex min-h-8 items-center justify-between gap-4 py-1 sm:py-1">
        <p className={labelClassName}>Description</p>
        <p className="font-semibold italic text-ink">None</p>
      </li>
    );
  }

  if (expanded) {
    const visible =
      description.length > MAX_CHARS
        ? `${description.slice(0, MAX_CHARS).trimEnd()}\u2026`
        : description;
    return (
      <li className="py-1 sm:py-1">
        <div className="flex items-center justify-between gap-4">
          <p className={labelClassName}>Description</p>
          <button
            type="button"
            onClick={() => setExpanded(false)}
            className={toggleClassName}
          >
            See less
          </button>
        </div>
        <p className="mt-0.5 whitespace-pre-wrap break-words font-semibold text-ink">
          {visible}
        </p>
      </li>
    );
  }

  if (description.length <= SHOW_MORE_THRESHOLD) {
    return (
      <li className="flex min-h-8 items-center justify-between gap-4 py-1 sm:py-1">
        <p className={labelClassName}>Description</p>
        <p className="min-w-0 truncate font-semibold text-ink">{description}</p>
      </li>
    );
  }

  const words = description.trim().split(/\s+/);

  if (words.length <= 3) {
    return (
      <li className="flex min-h-8 items-center justify-between gap-4 py-1 sm:py-1">
        <p className={labelClassName}>Description</p>
        <p className="min-w-0 truncate font-semibold text-ink">
          {description.trim()}
        </p>
      </li>
    );
  }

  const preview = `${words.slice(0, 3).join(" ")}\u2026`;

  return (
    <li className="flex min-h-8 items-center justify-between gap-4 py-1 sm:py-1">
      <p className={labelClassName}>Description</p>
      <span className="flex min-w-0 items-center gap-2">
        <span className="min-w-0 truncate font-semibold text-ink">
          {preview}
        </span>
        <button
          type="button"
          onClick={() => setExpanded(true)}
          className={toggleClassName}
        >
          See more
        </button>
      </span>
    </li>
  );
}

function CourseAbout({
  course,
  fillColor,
  onEdit,
}: {
  course: CourseListItem;
  fillColor: string | null;
  onEdit: () => void;
}) {
  const colorLabel = getCourseColorLabel(fillColor);
  const iconLabel = getCourseIconLabel(course.icon);

  return (
    <div>
      <div className="flex items-center justify-between gap-2">
        <h2 className="font-display text-[32px] font-semibold leading-[1.07] tracking-[-0.28px] text-ink sm:text-[36px] lg:text-[44px]">
          About
        </h2>
        <Button
          type="button"
          onClick={onEdit}
          aria-label="Edit course"
          size="icon"
          variant="outline"
          className="hidden shrink-0 rounded-full bg-white md:inline-flex"
        >
          <Pencil className="size-5" strokeWidth={2} aria-hidden="true" />
        </Button>
      </div>
      <p className="mt-2 text-[15px] leading-[1.47] tracking-[-0.374px] text-ink-muted-64 sm:text-[17px]">
        Course details and settings.
      </p>

      <div className="mt-6 hidden space-y-3 border-t border-hairline pt-2 sm:mt-8 lg:block">
        <h3 className="mb-6 font-display text-2xl font-semibold text-ink">
          Information
        </h3>
        <div className="mt-9 hidden gap-4 lg:grid lg:grid-cols-3 lg:gap-8">
          <div className="min-w-0">
            <p className="text-[15px] font-medium leading-relaxed text-ink-muted-48 sm:text-[17px]">
              Title
            </p>
            <p className="-mt-1 font-semibold text-ink">{course.name}</p>
          </div>
          <div className="min-w-0">
            <p className="text-[15px] font-medium leading-relaxed text-ink-muted-48 sm:text-[17px]">
              Code
            </p>
            {course.code ? (
              <p className="-mt-1 font-semibold text-ink">{course.code}</p>
            ) : (
              <p className="-mt-1 font-semibold italic text-ink">None</p>
            )}
          </div>
          <div className="min-w-0">
            <p className="text-[15px] font-medium leading-relaxed text-ink-muted-48 sm:text-[17px]">
              Color
            </p>
            <span className="-mt-1 flex items-center gap-1.5 font-semibold text-ink">
              <span
                aria-hidden
                className={cn(
                  "size-3.5 shrink-0 rounded-full border border-hairline",
                  !fillColor && "bg-transparent",
                )}
                style={fillColor ? { backgroundColor: fillColor } : undefined}
              />
              {colorLabel}
            </span>
          </div>
          <div className="min-w-0">
            <p className="text-[15px] font-medium leading-relaxed text-ink-muted-48 sm:text-[17px]">
              Icon
            </p>
            <span className="-mt-1 flex items-center gap-1.5 font-semibold text-ink">
              {course.icon ? (
                <CourseIconView
                  slug={course.icon}
                  className="size-3.5 shrink-0"
                  strokeWidth={2}
                />
              ) : null}
              {iconLabel}
            </span>
          </div>
        </div>
        <div className="pt-6">
          <p className="text-[15px] font-medium leading-relaxed text-ink-muted-48 sm:text-[17px]">
            Description
          </p>
          {course.description?.trim() ? (
            <p className="-mt-1 whitespace-pre-wrap font-semibold text-ink">
              {course.description}
            </p>
          ) : (
            <p className="-mt-1 font-semibold italic text-ink">None</p>
          )}
        </div>
      </div>

      <div className="mt-6 border-t border-hairline pt-2 sm:mt-8 lg:hidden">
        <h3 className="mb-1 font-display text-2xl font-semibold text-ink">
          Information
        </h3>
        <ul aria-label="Course information" className="list-none">
          <li className="flex min-h-8 items-center justify-between gap-4 py-1 sm:py-1">
            <p className="shrink-0 text-[15px] font-medium leading-relaxed text-ink-muted-48 sm:text-[17px]">
              Title
            </p>
            <p className="min-w-0 truncate font-semibold text-ink">
              {course.name}
            </p>
          </li>
          <li className="flex min-h-8 items-center justify-between gap-4 py-1 sm:py-1">
            <p className="shrink-0 text-[15px] font-medium leading-relaxed text-ink-muted-48 sm:text-[17px]">
              Code
            </p>
            {course.code ? (
              <p className="min-w-0 truncate font-semibold text-ink">
                {course.code}
              </p>
            ) : (
              <p className="font-semibold italic text-ink">None</p>
            )}
          </li>
          <li className="flex min-h-8 items-center justify-between gap-4 py-1 sm:py-1">
            <p className="shrink-0 text-[15px] font-medium leading-relaxed text-ink-muted-48 sm:text-[17px]">
              Color
            </p>
            <span className="flex min-w-0 items-center gap-1.5 font-semibold text-ink">
              <span
                aria-hidden
                className={cn(
                  "size-3.5 shrink-0 rounded-full border border-hairline",
                  !fillColor && "bg-transparent",
                )}
                style={fillColor ? { backgroundColor: fillColor } : undefined}
              />
              <span className="truncate">{colorLabel}</span>
            </span>
          </li>
          <li className="flex min-h-8 items-center justify-between gap-4 py-1 sm:py-1">
            <p className="shrink-0 text-[15px] font-medium leading-relaxed text-ink-muted-48 sm:text-[17px]">
              Icon
            </p>
            <span className="flex min-w-0 items-center gap-1.5 font-semibold text-ink">
              {course.icon ? (
                <CourseIconView
                  slug={course.icon}
                  className="size-3.5 shrink-0"
                  strokeWidth={2}
                />
              ) : null}
              <span className="truncate">{iconLabel}</span>
            </span>
          </li>
          <MobileCourseDescriptionRow description={course.description} />
        </ul>
      </div>
      <Button
        type="button"
        onClick={onEdit}
        aria-label="Edit course"
        variant="outline"
        className="fixed right-4 bottom-[max(1.25rem,env(safe-area-inset-bottom))] z-40 size-14 rounded-full bg-white p-0 shadow-lg md:hidden"
      >
        <Pencil className="size-5" strokeWidth={2} aria-hidden="true" />
      </Button>
    </div>
  );
}
function CourseTasks({
  course,
  groups,
  filteredTasks,
  taskView,
  hasTasks,
  timeZone,
  timeFormat,
  now,
  coursePath,
  onAdd,
}: {
  course: CourseListItem;
  groups: CourseTaskGroups<CourseDetailTask>;
  filteredTasks: CourseDetailTask[];
  taskView: CourseTaskView;
  hasTasks: boolean;
  timeZone: string;
  timeFormat: TimeFormat;
  now: Date;
  coursePath: string;
  onAdd: () => void;
}) {
  const cardCounts = useMemo(
    () => ({
      upcoming: groups.upcoming.length,
      overdue: groups.late.length,
      done: groups.done.length,
    }),
    [groups],
  );

  if (!hasTasks) {
    return (
      <div className="space-y-6">
        <h2 className="font-display text-[32px] font-semibold leading-[1.07] tracking-[-0.28px] text-ink sm:text-[36px] lg:text-[44px]">
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
            onClick={onAdd}
            className="mt-6 min-h-11 w-full max-w-xs rounded-full px-5 sm:w-auto"
          >
            <Plus className="size-4" strokeWidth={2} aria-hidden="true" />
            Add task
          </Button>
        </div>
      </div>
    );
  }

  const viewTitle = taskView === "all" ? "Tasks" :
    taskView === "upcoming" ? "Upcoming correlated task" :
    taskView === "overdue" ? "Overdue correlated task" : "Done correlated task";

  if (taskView !== "all" && filteredTasks.length === 0) {
    const config = {
      upcoming: {
        headline: "No upcoming tasks",
        supporting: "You're all caught up.",
        showAddButton: true,
      },
      overdue: {
        headline: "No overdue tasks",
        supporting: "You're all caught up.",
        showAddButton: false,
      },
      done: {
        headline: "No completed tasks",
        supporting: "Completed tasks will appear here.",
        showAddButton: false,
      },
    }[taskView];

    return (
      <div className="space-y-6">
        <h2 className="font-display text-[32px] font-semibold leading-[1.07] tracking-[-0.28px] text-ink sm:text-[36px] lg:text-[44px]">
          {viewTitle}
        </h2>
        <div className="flex flex-col items-center px-2 py-10 text-center sm:px-4 sm:py-14">
          <h3 className="font-display text-xl font-semibold text-ink sm:text-[22px]">
            {config.headline}
          </h3>
          <p className="mt-2 max-w-sm text-[15px] leading-relaxed text-ink-muted-48">
            {config.supporting}
          </p>
          {config.showAddButton ? (
            <Button
              type="button"
              onClick={onAdd}
              className="mt-6 min-h-11 w-full max-w-xs rounded-full px-5 sm:w-auto"
            >
              <Plus className="size-4" strokeWidth={2} aria-hidden="true" />
              Add task
            </Button>
          ) : null}
        </div>
      </div>
    );
  }

  return (
    <div
      className={cn(
        taskView === "all" ? "space-y-6 sm:space-y-8" : "space-y-5 sm:space-y-6",
      )}
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <h2 className="font-display text-[32px] font-semibold leading-[1.07] tracking-[-0.28px] text-ink sm:text-[36px] lg:text-[44px]">
            {viewTitle}
          </h2>
        </div>
        {taskView !== "done" ? (
          <Button
            type="button"
            onClick={onAdd}
            aria-label="Add task"
            size="icon"
            className="hidden rounded-full md:inline-flex"
          >
            <Plus className="size-5" strokeWidth={2} aria-hidden="true" />
          </Button>
        ) : null}
      </div>

      <div className="space-y-6">
        {taskView === "all" ? (
          <>
            <CourseTaskSummaryCards
              counts={cardCounts}
              coursePath={coursePath}
            />
            {filteredTasks.length === 0 ? (
              <p className="py-8 text-center text-[15px] text-ink-muted-48">
                No tasks yet.
              </p>
            ) : (
              <CourseTaskGroup
                title="All correlated task"
                tone="neutral"
                tasks={filteredTasks}
                timeZone={timeZone}
                timeFormat={timeFormat}
                now={now}
                dateOnRight
              />
            )}
          </>
        ) : (
          <CourseTaskGroup
            title={viewTitle}
            tone={taskView === "overdue" ? "late" : taskView === "upcoming" ? "upcoming" : "done"}
            tasks={filteredTasks}
            timeZone={timeZone}
            timeFormat={timeFormat}
            now={now}
            dateOnRight={taskView !== "done"}
            bare
          />
        )}
      </div>

      {taskView === "all" ? (
        <p className="pb-2 text-center text-sm text-ink-muted-48">
          That&apos;s all for now.
        </p>
      ) : null}

      {taskView !== "done" ? (
        <Button
          type="button"
          onClick={onAdd}
          aria-label="Add task"
          className="fixed right-4 bottom-[max(1.25rem,env(safe-area-inset-bottom))] z-40 size-14 rounded-full p-0 shadow-lg md:hidden"
        >
          <Plus className="size-5" strokeWidth={2} aria-hidden="true" />
        </Button>
      ) : null}
    </div>
  );
}

export function CourseDetail({ course, tasks, timeZone, timeFormat, taskView, nowIso }: CourseDetailProps) {
  const now = useNow(60_000, nowIso);
  const [view, setView] = useState<CourseView>("task");
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);

  const groups = useMemo(() => groupCourseTasks(tasks, now), [tasks, now]);
  const fillColor = getCourseColorFill(course.color);
  const coursePath = `/courses/${course.id}`;
  const openAdd = () => setAddOpen(true);
  const closeSidebar = () => setSidebarOpen(false);

  const filteredTasks = useMemo(() => {
    if (taskView === "all") return tasks;
    
    switch (taskView) {
      case "upcoming": return groups.upcoming;
      case "overdue": return groups.late;
      case "done": return groups.done;
      default: return tasks;
    }
  }, [tasks, taskView, groups]);

  return (
    <section className="space-y-6 sm:space-y-8">
      <LearnSecondaryNav
        onOpenSidebar={() => setSidebarOpen(true)}
        openSidebarLabel="Open course sections"
      />

      <div className="grid grid-cols-1 gap-10 lg:grid-cols-[240px_minmax(0,1fr)]">
        <div className="hidden lg:block">
          <p className="mb-4 flex min-w-0 items-center gap-2 font-display text-xl font-semibold text-ink" title={course.name}>
            {course.icon ? (
              <CourseIconView
                slug={course.icon}
                className="size-5 shrink-0"
                strokeWidth={2}
              />
            ) : null}
            <span className="min-w-0 truncate">{course.name}</span>
          </p>
          <CourseSidebarNav
            view={view}
            taskView={taskView}
            coursePath={coursePath}
            onChange={setView}
            onDelete={() => setDeleteOpen(true)}
          />
        </div>

        <div>
          {view === "task" ? (
            <CourseTasks
              course={course}
              groups={groups}
              filteredTasks={filteredTasks}
              taskView={taskView}
              hasTasks={tasks.length > 0}
              timeZone={timeZone}
              timeFormat={timeFormat}
              now={now}
              coursePath={coursePath}
              onAdd={openAdd}
            />
          ) : (
            <CourseAbout
              course={course}
              fillColor={fillColor}
              onEdit={() => setEditOpen(true)}
            />
          )}
        </div>
      </div>

      {sidebarOpen ? (
        <div
          aria-hidden="true"
          onClick={closeSidebar}
          className="fixed inset-x-0 bottom-0 top-13 z-40 bg-ink/30 lg:hidden"
        />
      ) : null}

      <div
        role="dialog"
        aria-label="Course sections"
        aria-modal={sidebarOpen}
        className={cn(
          "fixed top-13 right-0 bottom-0 left-0 z-50 flex w-full flex-col border-t border-hairline bg-canvas transition-transform duration-200 ease-out lg:hidden",
          sidebarOpen ? "translate-x-0" : "-translate-x-full",
        )}
      >
        <div className="flex shrink-0 items-center justify-between px-5 pt-5 pb-3">
          <span className="flex min-w-0 items-center gap-2 text-[22px] font-bold leading-tight tracking-[-0.48px] text-ink">
            {course.icon ? (
              <CourseIconView
                slug={course.icon}
                className="size-5 shrink-0"
                strokeWidth={2}
              />
            ) : null}
            <span className="min-w-0 truncate">{course.name}</span>
          </span>
          <button
            type="button"
            onClick={closeSidebar}
            aria-label="Close sidebar"
            className="inline-flex size-9 items-center justify-center rounded-md text-ink-muted-48 transition-colors hover:bg-muted hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-focus"
          >
            <X className="size-5" strokeWidth={2} aria-hidden="true" />
          </button>
        </div>
        <div className="px-5 pb-4">
          <CourseSidebarNav
            view={view}
            taskView={taskView}
            coursePath={coursePath}
            onChange={setView}
            onNavigate={closeSidebar}
            onDelete={() => {
              setDeleteOpen(true);
              closeSidebar();
            }}
          />
        </div>
      </div>

      <Dialog open={addOpen} onOpenChange={setAddOpen} title="Add task">
        <div className="w-full text-left">
          <AddTaskForm
            courses={[course]}
            timeZone={timeZone}
            lockedCourseId={course.id}
            returnTo={
              taskView === "all" ? coursePath : `${coursePath}?view=${taskView}`
            }
            onCancel={() => setAddOpen(false)}
          />
        </div>
      </Dialog>

      <Dialog open={editOpen} onOpenChange={setEditOpen} title="Edit course">
        <div className="w-full text-left">
          <CourseForm
            course={course}
            submitLabel="Save changes"
            onCancel={() => setEditOpen(false)}
            onSuccess={() => setEditOpen(false)}
          />
        </div>
      </Dialog>

      <DeleteCourseDialog
        course={course}
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
      />
    </section>
  );
}