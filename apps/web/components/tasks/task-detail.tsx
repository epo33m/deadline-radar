"use client";

import Link from "next/link";
import { Check, PanelLeft, Pencil, Trash2, X } from "lucide-react";
import { useActionState, useState } from "react";
import type { TimeFormat } from "@deadline-radar/validation";

import {
  completeTask,
  softDeleteTask,
  type TaskActionState,
} from "@/app/actions/tasks";
import { AttachmentManager } from "@/components/tasks/attachment-manager";
import { TaskForm } from "@/components/tasks/task-form";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { LoadingDialog } from "@/components/ui/loading-dialog";
import { StatusSteps } from "@/components/tasks/status-steps";
import { ThresholdManager } from "@/components/tasks/threshold-manager";
import { shellContainerClassName } from "@/components/ui/shell-layout";
import {
  formatDeadlineDate,
  formatDeadlineTime,
} from "@/lib/datetime";
import { formatRelativeDeadline } from "@/lib/deadline-relative";
import { useNow } from "@/lib/use-now";
import { cn } from "@/lib/utils";
import type { CourseListItem } from "@/types/course";
import type { Attachment, ReminderThreshold, TaskDetail } from "@/types/task";

const initialState: TaskActionState = {};

type TaskView = "details" | "reminders" | "attachments";

const TASK_VIEWS: { id: TaskView; label: string }[] = [
  { id: "details", label: "Details" },
  { id: "reminders", label: "Reminders" },
  { id: "attachments", label: "Attachments" },
];

type TaskDetailPanelProps = {
  task: TaskDetail;
  courses: CourseListItem[];
  thresholds: ReminderThreshold[];
  attachments: Attachment[];
  timeZone: string;
  timeFormat: TimeFormat;
  nowIso?: string;
};

function SidebarRemoveForm({ taskId }: { taskId: string }) {
  const [state, formAction, pending] = useActionState(
    softDeleteTask,
    initialState,
  );

  return (
    <>
      <LoadingDialog
        open={pending}
        title="Removing task…"
        description="Please wait a moment"
      />
      <form action={formAction}>
        <input type="hidden" name="id" value={taskId} />
        <button
          type="submit"
          disabled={pending}
          className="flex w-full items-center gap-2 rounded-sm px-2 py-2 text-left text-[17px] leading-tight tracking-[-0.374px] text-destructive transition-colors hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-focus disabled:opacity-60"
        >
          <Trash2 className="size-4" strokeWidth={2} aria-hidden="true" />
          {pending ? "Removing…" : "Remove task"}
        </button>
        {state.error ? (
          <p className="mt-2 px-2 text-sm text-destructive" role="alert">
            {state.error}
          </p>
        ) : null}
      </form>
    </>
  );
}

/** Terminal-Done (DOMAIN.md §2.3): completion is an explicit action, not a status-picker option. */
function MarkDoneForm({ taskId }: { taskId: string }) {
  const [state, formAction, pending] = useActionState(
    completeTask,
    initialState,
  );

  return (
    <>
      <LoadingDialog
        open={pending}
        title="Completing task…"
        description="Please wait a moment"
      />
      <form action={formAction}>
        <input type="hidden" name="id" value={taskId} />
        <Button type="submit" disabled={pending} className="shrink-0">
          <Check className="size-4" strokeWidth={2.25} aria-hidden="true" />
          {pending ? "Completing…" : "Mark as done"}
        </Button>
        {state.error ? (
          <p className="mt-2 text-sm text-destructive" role="alert">
            {state.error}
          </p>
        ) : null}
      </form>
    </>
  );
}

function TaskSidebarNav({
  view,
  onChange,
  taskId,
  onNavigate,
  className,
}: {
  view: TaskView;
  onChange: (view: TaskView) => void;
  taskId: string;
  onNavigate?: () => void;
  className?: string;
}) {
  const itemClassName = (selected: boolean) =>
    cn(
      "flex w-full items-center rounded-sm px-2 py-2 text-left text-[17px] leading-tight tracking-[-0.374px] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-focus",
      selected
        ? "bg-muted font-semibold text-ink"
        : "text-ink-muted-80 hover:bg-muted/60 hover:text-ink",
    );

  return (
    <nav aria-label="Task sections" className={cn("min-w-0", className)}>
      <ul className="flex flex-col space-y-3">
        {TASK_VIEWS.map((item) => {
          const selected = view === item.id;
          return (
            <li key={item.id}>
              <button
                type="button"
                aria-pressed={selected}
                onClick={() => {
                  onChange(item.id);
                  onNavigate?.();
                }}
                className={itemClassName(selected)}
              >
                {item.label}
              </button>
            </li>
          );
        })}
      </ul>

      <div className="mt-5 border-t border-hairline pt-3">
        <SidebarRemoveForm taskId={taskId} />
      </div>
    </nav>
  );
}

const MOBILE_DESCRIPTION_MAX_CHARS = 300;
const MOBILE_DESCRIPTION_SHOW_MORE_THRESHOLD = 15;

function MobileDescriptionRow({
  description,
}: {
  description: string | null;
}) {
  const [expanded, setExpanded] = useState(false);

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
      description.length > MOBILE_DESCRIPTION_MAX_CHARS
        ? `${description.slice(0, MOBILE_DESCRIPTION_MAX_CHARS).trimEnd()}…`
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

  if (description.length <= MOBILE_DESCRIPTION_SHOW_MORE_THRESHOLD) {
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

  const preview = `${words.slice(0, 3).join(" ")}…`;

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

export function TaskDetailPanel({
  task,
  courses,
  thresholds,
  attachments,
  timeZone,
  timeFormat,
  nowIso,
}: TaskDetailPanelProps) {
  const now = useNow(60_000, nowIso);
  const [view, setView] = useState<TaskView>("details");
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const closeSidebar = () => setSidebarOpen(false);
  // Terminal Done (DOMAIN.md §2.3): completed tasks are read-only and
  // cannot be reopened — no edit affordance, only the completed state.
  const isDone = task.status === "done";

  return (
    <section className="space-y-6 sm:space-y-8">
      <div className="relative left-1/2 -mt-5 w-screen -translate-x-1/2 border-b border-hairline bg-canvas py-3 sm:-mt-6 sm:py-3.5 lg:-mt-8">
        <div className={shellContainerClassName}>
          <div className="flex items-center">
            <button
              type="button"
              onClick={() => setSidebarOpen(true)}
              aria-label="Open task sections"
              className="-ml-2 mr-2.5 inline-flex size-9 shrink-0 items-center justify-center rounded-md text-ink transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-focus lg:hidden"
            >
              <PanelLeft
                className="size-5"
                strokeWidth={2.25}
                aria-hidden="true"
              />
            </button>
            <span
              aria-hidden="true"
              className="mx-2.5 h-5 w-[1.5px] shrink-0 bg-ink lg:hidden"
            />
            <p className="ml-2.5 text-[22px] font-semibold leading-tight lg:ml-0">
              <Link
                href="/tasks"
                className="text-ink hover:text-ink/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                Tasks
              </Link>
            </p>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-10 lg:grid-cols-[240px_minmax(0,1fr)]">
        <div className="hidden lg:block">
          <p
            className="mb-4 font-display text-xl font-semibold text-ink truncate"
            title={task.title}
          >
            {task.title}
          </p>
          <TaskSidebarNav
            view={view}
            onChange={setView}
            taskId={task.id}
          />
        </div>

        <div className="min-w-0">
          {view === "details" ? (
            <div className="pb-20 md:pb-0">
              <div className="flex items-center justify-between gap-2">
                <h2 className="font-display text-[32px] font-semibold leading-[1.07] tracking-[-0.28px] text-ink sm:text-[36px] lg:text-[44px]">
                  Details
                </h2>
                {isDone ? null : (
                  <div className="flex shrink-0 items-center gap-2">
                    <MarkDoneForm taskId={task.id} />
                    <Button
                      type="button"
                      onClick={() => setEditOpen(true)}
                      aria-label="Edit task"
                      size="icon"
                      variant="outline"
                      className="hidden rounded-full bg-white md:inline-flex"
                    >
                      <Pencil className="size-5" strokeWidth={2} aria-hidden="true" />
                    </Button>
                  </div>
                )}
              </div>
              <p className="mt-2 text-[15px] leading-[1.47] tracking-[-0.374px] text-ink-muted-64 sm:text-[17px]">
                Task details and information.
              </p>
              <div className="mt-6 hidden space-y-3 border-t border-hairline pt-2 sm:mt-8 lg:block">
                <h3 className="mb-6 font-display text-2xl font-semibold text-ink">
                  Information
                </h3>
                <div className="grid grid-cols-2 gap-4">
                  <div className="min-w-0">
                    <p className="text-[15px] font-medium leading-relaxed text-ink-muted-48 sm:text-[17px]">
                      Title
                    </p>
                    <p className="-mt-1 font-semibold text-ink">{task.title}</p>
                  </div>
                  <div className="min-w-0">
                    <p className="text-[15px] font-medium leading-relaxed text-ink-muted-48 sm:text-[17px]">
                      Course
                    </p>
                    {task.course_name ? (
                      <Link
                        href={`/courses/${task.course_id}`}
                        className="-mt-1 block truncate font-semibold text-primary underline underline-offset-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      >
                        {task.course_code ? `${task.course_code} · ` : ""}
                        {task.course_name}
                      </Link>
                    ) : (
                      <p className="-mt-1 font-semibold italic text-ink">
                        None
                      </p>
                    )}
                  </div>
                </div>
                <div className="pt-6">
                  <p className="text-[15px] font-medium leading-relaxed text-ink-muted-48 sm:text-[17px]">
                    Description
                  </p>
                  {task.description ? (
                    <p className="-mt-1 whitespace-pre-wrap font-semibold text-ink">
                      {task.description}
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
                <ul aria-label="Task information" className="list-none">
                <li className="flex min-h-8 items-center justify-between gap-4 py-1 sm:py-1">
                  <p className="shrink-0 text-[15px] font-medium leading-relaxed text-ink-muted-48 sm:text-[17px]">
                    Title
                  </p>
                    <p className="min-w-0 truncate font-semibold text-ink">
                      {task.title}
                    </p>
                  </li>
                <li className="flex min-h-8 items-center justify-between gap-4 py-1 sm:py-1">
                  <p className="shrink-0 text-[15px] font-medium leading-relaxed text-ink-muted-48 sm:text-[17px]">
                    Course
                  </p>
                    {task.course_name ? (
                      <Link
                        href={`/courses/${task.course_id}`}
                        className="min-w-0 truncate font-semibold text-primary underline underline-offset-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      >
                        {task.course_code ? `${task.course_code} · ` : ""}
                        {task.course_name}
                      </Link>
                    ) : (
                      <p className="font-semibold italic text-ink">None</p>
                    )}
                  </li>
                  <MobileDescriptionRow description={task.description} />
                </ul>
              </div>
              <div className="mt-6 border-t border-hairline pt-2 sm:mt-8 lg:mt-10">
                <h3 className="mb-1 font-display text-2xl font-semibold text-ink lg:mb-6">
                  Progress
                </h3>
                <div className="mt-1 lg:mt-3">
                  <StatusSteps status={task.status} />
                </div>
                <div className="mt-9 hidden gap-4 lg:grid lg:grid-cols-3 lg:gap-8">
                  <div className="min-w-0">
                    <p className="text-[15px] font-medium leading-relaxed text-ink-muted-48 sm:text-[17px]">
                      Deadline
                    </p>
                    <p className="-mt-1 truncate font-semibold text-ink">
                      {formatRelativeDeadline(task.deadline, timeZone, now)}
                    </p>
                  </div>
                  <div className="min-w-0">
                    <p className="text-[15px] font-medium leading-relaxed text-ink-muted-48 sm:text-[17px]">
                      Date
                    </p>
                    <p className="-mt-1 truncate font-semibold text-ink">
                      {formatDeadlineDate(task.deadline, timeZone)}
                    </p>
                  </div>
                  <div className="min-w-0">
                    <p className="text-[15px] font-medium leading-relaxed text-ink-muted-48 sm:text-[17px]">
                      Time
                    </p>
                    <p className="-mt-1 truncate font-semibold text-ink">
                      {formatDeadlineTime(task.deadline, timeZone, timeFormat)}
                    </p>
                  </div>
                </div>
                <ul
                  aria-label="Task progress details"
                  className="mt-1 list-none lg:hidden"
                >
                  <li className="flex min-h-8 items-center justify-between gap-4 py-1 sm:py-1">
                    <p className="shrink-0 text-[15px] font-medium leading-relaxed text-ink-muted-48 sm:text-[17px]">
                      Deadline
                    </p>
                    <p className="min-w-0 truncate font-semibold text-ink">
                      {formatRelativeDeadline(task.deadline, timeZone, now)}
                    </p>
                  </li>
                  <li className="flex min-h-8 items-center justify-between gap-4 py-1 sm:py-1">
                    <p className="shrink-0 text-[15px] font-medium leading-relaxed text-ink-muted-48 sm:text-[17px]">
                      Date
                    </p>
                    <p className="min-w-0 truncate font-semibold text-ink">
                      {formatDeadlineDate(task.deadline, timeZone)}
                    </p>
                  </li>
                  <li className="flex min-h-8 items-center justify-between gap-4 py-1 sm:py-1">
                    <p className="shrink-0 text-[15px] font-medium leading-relaxed text-ink-muted-48 sm:text-[17px]">
                      Time
                    </p>
                    <p className="min-w-0 truncate font-semibold text-ink">
                      {formatDeadlineTime(task.deadline, timeZone, timeFormat)}
                    </p>
                  </li>
                </ul>
              </div>
              {isDone ? null : (
                <Button
                  type="button"
                  onClick={() => setEditOpen(true)}
                  aria-label="Edit task"
                  variant="outline"
                  className="fixed right-4 bottom-[max(1.25rem,env(safe-area-inset-bottom))] z-40 size-14 rounded-full bg-white p-0 shadow-lg md:hidden"
                >
                  <Pencil className="size-5" strokeWidth={2} aria-hidden="true" />
                </Button>
              )}
            </div>
          ) : null}

          {view === "reminders" ? (
            <ThresholdManager
              taskId={task.id}
              deadline={task.deadline}
              timeZone={timeZone}
              thresholds={thresholds}
            />
          ) : null}

          {view === "attachments" ? (
            <AttachmentManager taskId={task.id} attachments={attachments} />
          ) : null}

          {isDone ? null : (
            <Dialog
              open={editOpen}
              onOpenChange={setEditOpen}
              title="Edit task"
            >
              <TaskForm
                task={task}
                courses={courses}
                timeZone={timeZone}
                submitLabel="Save changes"
                onSuccess={() => setEditOpen(false)}
                onCancel={() => setEditOpen(false)}
              />
            </Dialog>
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
        aria-label="Task sections"
        aria-modal={sidebarOpen}
        className={cn(
          "fixed top-13 right-0 bottom-0 left-0 z-50 flex w-full flex-col border-t border-hairline bg-canvas transition-transform duration-200 ease-out lg:hidden",
          sidebarOpen ? "translate-x-0" : "-translate-x-full",
        )}
      >
        <div className="flex shrink-0 items-center justify-between px-5 pt-5 pb-3">
          <span className="min-w-0 truncate text-[22px] font-bold leading-tight tracking-[-0.48px] text-ink">
            {task.title}
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
          <TaskSidebarNav
            view={view}
            onChange={setView}
            taskId={task.id}
            onNavigate={closeSidebar}
          />
        </div>
      </div>
    </section>
  );
}
