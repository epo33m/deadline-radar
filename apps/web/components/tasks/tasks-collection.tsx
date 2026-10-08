"use client";

import Link from "next/link";
import { Check, CheckSquare, Circle, ListFilter, Plus, Search } from "lucide-react";
import { useId, useDeferredValue, useMemo, useRef, useState, memo, type ReactNode } from "react";
import type { TimeFormat } from "@deadline-radar/validation";

import { AddTaskForm } from "@/components/tasks/task-form";
import { LearnSecondaryNav } from "@/components/learn/learn-secondary-nav";
import { CourseIconView } from "@/components/courses/course-icon";
import {
  findCourseColorOption,
  getCourseCardPresentation,
  getCourseColorFill,
} from "@/lib/courses/colors";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { PageHeader } from "@/components/ui/page-header";
import { PortalMenu } from "@/components/ui/portal-menu";
import type { TaskStatus } from "@/lib/validation/task";
import { formatDeadlineDate, formatDeadlineTime } from "@/lib/datetime";
import {
  filterTasksByStatusView,
  resolveTaskTone,
  resolveTasksEmptyState,
  type TasksStatusView,
} from "@/lib/tasks/global-tasks";
import { cn } from "@/lib/utils";
import { useNow } from "@/lib/use-now";
import { sortTasksAllView } from "@/lib/task-sort";
import type { CourseListItem } from "@/types/course";
import type { TaskListItem } from "@/types/task";

/** Show search once the collection is large enough to justify it (UX-008). */
const SEARCH_MIN_TASKS = 8;

/** v1: filter dropdown hidden, pills are the only status control. */
const SHOW_FILTER_BUTTON = false;

const STATUS_VIEWS: { id: TasksStatusView; label: string }[] = [
  { id: "all", label: "All" },
  { id: "upcoming", label: "Upcoming" },
  { id: "late", label: "Overdue" },
  { id: "done", label: "Done" },
];

/** Card badge — same labels/colors as StatusPicker in task detail. */
const CARD_STATUS_META: Record<TaskStatus, { label: string; pillClass: string }> = {
  todo: { label: "To do", pillClass: "border-transparent bg-ink/60 text-white" },
  in_progress: { label: "In progress", pillClass: "border-transparent bg-warning text-ink" },
  done: { label: "Completed", pillClass: "border-transparent bg-success text-white" },
};

type RowTone = "late" | "upcoming" | "done";

const TONE_CIRCLE_CLASS: Record<RowTone, string> = {
  late: "bg-destructive/10 text-destructive",
  upcoming: "bg-warning/10 text-warning",
  done: "bg-success/10 text-success",
};

const TONE_INDICATOR_LABEL: Record<RowTone, string> = {
  late: "Late",
  upcoming: "Upcoming",
  done: "Done",
};

type TasksCollectionProps = {
  courses: CourseListItem[];
  tasks: TaskListItem[];
  timeZone: string;
  timeFormat: TimeFormat;
  nowIso?: string;
  /**
   * Paging control rendered under the list (#141). Passed in as a node so this
   * component stays purely prop-driven — the rows it renders are accumulated
   * server-side from `?pages=N`, never appended in the browser.
   */
  pager?: ReactNode;
};

function matchesSearch(task: TaskListItem, query: string): boolean {
  if (!query) return true;
  const haystack = `${task.title} ${task.course_name ?? ""}`.toLowerCase();
  return haystack.includes(query);
}

/**
 * Memoized: parent re-renders on every keystroke and every 60s `useNow`
 * tick, but all props are memo-stable (task object identity survives
 * filter/sort; tone/timeZone/courseIcon are primitives). Rows whose inputs
 * are unchanged skip re-render.
 */
const TaskRow = memo(function TaskRow({
  task,
  timeZone,
  timeFormat,
  tone,
  courseIcon,
}: {
  task: TaskListItem;
  timeZone: string;
  timeFormat: TimeFormat;
  tone: RowTone;
  courseIcon: string | null | undefined;
}) {
  const completed = tone === "done";
  const statusMeta = CARD_STATUS_META[task.status] ?? CARD_STATUS_META.todo;
  const courseFill = getCourseColorFill(task.course_color);
  const cardPresentation = getCourseCardPresentation(
    findCourseColorOption(task.course_color)?.token,
  );
  const metaSuffix = completed
    ? "Completed"
    : `${formatDeadlineDate(task.deadline, timeZone)}, ${formatDeadlineTime(task.deadline, timeZone, timeFormat)}`;

  return (
    <li className="overflow-hidden rounded-lg border border-hairline/80 bg-canvas shadow-none transition-colors hover:bg-muted/30 focus-within:ring-2 focus-within:ring-ring">
      <Link
        href={`/tasks/${task.id}`}
        className="flex h-full w-full flex-col gap-2.5 rounded-lg p-4 outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset sm:p-5"
      >
        <div className="mb-5 flex shrink-0 items-center justify-start">
          <span
            className={cn(
              "flex size-10 shrink-0 items-center justify-center rounded-full",
              !cardPresentation &&
                (courseFill ? "text-ink" : TONE_CIRCLE_CLASS[tone]),
            )}
            style={
              cardPresentation
                ? { background: cardPresentation.gradient }
                : courseFill
                  ? {
                      backgroundColor: `color-mix(in srgb, ${courseFill} 75%, transparent)`,
                    }
                  : undefined
            }
            aria-hidden="true"
          >
            {courseIcon ? (
              <CourseIconView
                slug={courseIcon}
                className={cn("size-5", cardPresentation?.iconClass)}
                strokeWidth={2}
              />
            ) : completed ? (
              <Check className="size-5" strokeWidth={2.25} />
            ) : (
              <Circle className="size-5" strokeWidth={2} />
            )}
          </span>
        </div>
        <span className="sr-only">{TONE_INDICATOR_LABEL[tone]}. </span>
        <p className="truncate text-sm leading-snug font-medium text-ink">
          {task.course_name ?? "Course"}
        </p>
        <p
          className={cn(
            "mb-5 line-clamp-2 text-[22px] font-bold leading-snug tracking-[-0.2px]",
            completed ? "text-ink-muted-80" : "text-ink",
          )}
        >
          {task.title}
        </p>
        <span className={cn("mt-auto flex w-full items-center gap-2 border-t border-hairline pt-2", completed ? "justify-end" : "justify-between")}>
          {!completed ? (
            <span className="min-w-0 truncate text-xs leading-snug text-ink-muted-48">
              {metaSuffix}
            </span>
          ) : null}
          <span className={cn("flex shrink-0 items-center rounded-full border px-2.5 py-1", statusMeta.pillClass)}>
            <span className="truncate text-sm leading-snug font-medium">
              {statusMeta.label}
            </span>
          </span>
        </span>
        <span className="sr-only">Open {task.title}</span>
      </Link>
    </li>
  );
});

function EmptyPanel({
  title,
  description,
  action,
}: {
  title: string;
  description: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex min-h-[min(28rem,calc(100svh-14rem))] flex-col items-center justify-center px-2 py-12 text-center sm:min-h-[min(32rem,calc(100svh-16rem))] sm:px-4 sm:py-16">
      <CheckSquare
        className="mb-4 size-12 text-ink-muted-48 sm:size-16"
        aria-hidden="true"
        strokeWidth={1.5}
      />
      <h2 className="font-display text-xl font-semibold text-ink sm:text-[22px]">
        {title}
      </h2>
      <p className="mt-2 max-w-sm text-[15px] leading-relaxed text-ink-muted-48">
        {description}
      </p>
      {action ? <div className="mt-6 w-full max-w-xs sm:w-auto">{action}</div> : null}
    </div>
  );
}

export function TasksCollection({
  courses,
  tasks,
  timeZone,
  timeFormat,
  nowIso,
  pager,
}: TasksCollectionProps) {
  const now = useNow(60_000, nowIso);
  const [view, setView] = useState<TasksStatusView>("all");
  const [query, setQuery] = useState("");
  const [addOpen, setAddOpen] = useState(false);
  const [filterOpen, setFilterOpen] = useState(false);
  const filterMenuId = useId();
  const filterTriggerRef = useRef<HTMLButtonElement>(null);
  const activeViewLabel =
    STATUS_VIEWS.find((item) => item.id === view)?.label ?? "All";

  const normalizedQuery = query.trim().toLowerCase();
  // Defer the expensive part (filter + sort + grid) so keystrokes stay
  // responsive; the input itself always shows the raw query.
  const deferredQuery = useDeferredValue(normalizedQuery);
  const searchEnabled =
    tasks.length >= SEARCH_MIN_TASKS || deferredQuery.length > 0;

  const courseIconById = useMemo(() => {
    const map = new Map<string, string | null>();
    for (const course of courses) map.set(course.id, course.icon ?? null);
    return map;
  }, [courses]);

  const searchedTasks = useMemo(
    () =>
      searchEnabled
        ? tasks.filter((task) => matchesSearch(task, deferredQuery))
        : tasks,
    [tasks, deferredQuery, searchEnabled],
  );

  const lateTasks = useMemo(
    () => filterTasksByStatusView(searchedTasks, "late", now),
    [searchedTasks, now],
  );
  const upcomingOpenTasks = useMemo(
    () => filterTasksByStatusView(searchedTasks, "upcoming", now),
    [searchedTasks, now],
  );
  const doneTasks = useMemo(
    () => filterTasksByStatusView(searchedTasks, "done"),
    [searchedTasks],
  );

  /** Default "All" view: active first (todo → in progress → done), nearest deadline first. */
  const allTasks = useMemo(() => sortTasksAllView(searchedTasks), [searchedTasks]);

  const filteredTasks =
    view === "all"
      ? allTasks
      : view === "late"
        ? lateTasks
        : view === "upcoming"
          ? upcomingOpenTasks
          : doneTasks;

  const emptyState = resolveTasksEmptyState({
    courseCount: courses.length,
    taskCount: tasks.length,
    filteredCount: filteredTasks.length,
  });

  const openAdd = () => setAddOpen(true);
  const showChrome = emptyState !== "no-courses" && emptyState !== "no-tasks";
  const hasCourses = courses.length > 0;

  return (
    <section className="space-y-6 sm:space-y-8">
      <LearnSecondaryNav />
      <PageHeader title="My Tasks" subtitle="Stay on top of what needs to get done." />

      {showChrome ? (
        <div
          className={
            emptyState === "ready" || emptyState === "no-results"
              ? "space-y-4 pb-20 sm:space-y-5 md:pb-0"
              : "space-y-4"
          }
        >
          <div className="flex flex-col gap-3 sm:grid sm:grid-cols-[1fr_auto_1fr] sm:items-center sm:gap-2">
            <h2 className="self-start font-display text-[19px] font-semibold tracking-[-0.2px] text-ink sm:justify-self-start sm:text-[21px]">
                All Tasks
            </h2>

            <div
              role="group"
              aria-label="Task status"
              className="flex flex-wrap justify-center gap-1.5 sm:justify-self-center"
            >
              {STATUS_VIEWS.map((item) => {
                const selected = view === item.id;
                return (
                  <button
                    key={item.id}
                    type="button"
                    aria-pressed={selected}
                    onClick={() => setView(item.id)}
                    className={cn(
                      "min-h-9 rounded-full px-3.5 text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                      selected
                        ? "bg-ink text-canvas"
                        : "bg-muted/60 text-ink-muted-80 hover:bg-muted hover:text-ink",
                    )}
                  >
                    {item.label}
                  </button>
                );
              })}
            </div>

            <div className="flex shrink-0 items-center justify-end gap-2 sm:justify-self-end">
              {SHOW_FILTER_BUTTON ? (
              <div className="relative">
                <Button
                  ref={filterTriggerRef}
                  type="button"
                  variant="outline"
                  size="icon"
                  aria-expanded={filterOpen}
                  aria-controls={filterMenuId}
                  aria-label={`Filter tasks, current: ${activeViewLabel}`}
                  onClick={() => setFilterOpen((current) => !current)}
                  className="relative rounded-full"
                >
                  <ListFilter className="size-5" strokeWidth={2} aria-hidden="true" />
                  {view !== "all" ? (
                    <span
                      aria-hidden="true"
                      className="absolute top-1.5 right-1.5 size-2 rounded-full bg-primary"
                    />
                  ) : null}
                </Button>

                <PortalMenu
                  open={filterOpen}
                  onClose={() => setFilterOpen(false)}
                  triggerRef={filterTriggerRef}
                  menuId={filterMenuId}
                  label="Filter tasks by status"
                  role="menu"
                  arrowNav
                  focusFirstOnOpen
                  measureOptions={{ minWidth: 200, align: "end" }}
                  className="p-1.5"
                >
                  {STATUS_VIEWS.map((item) => {
                    const selected = view === item.id;
                    return (
                      <button
                        key={item.id}
                        type="button"
                        role="menuitemradio"
                        aria-checked={selected}
                        onClick={() => {
                          setView(item.id);
                          setFilterOpen(false);
                        }}
                        className={cn(
                          "flex min-h-11 w-full items-center justify-between gap-4 rounded-lg px-3 py-2 text-left text-sm outline-none transition-colors hover:bg-muted/60 focus-visible:bg-muted/60 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset",
                          selected
                            ? "font-semibold text-ink"
                            : "font-medium text-ink-muted-80",
                        )}
                      >
                        {item.label}
                        {selected ? (
                          <Check
                            className="size-4 shrink-0 text-primary"
                            strokeWidth={2.25}
                            aria-hidden="true"
                          />
                        ) : null}
                      </button>
                    );
                  })}
                </PortalMenu>
              </div>
              ) : null}

              {hasCourses ? (
                <Button
                  type="button"
                  onClick={openAdd}
                  aria-label="Add task"
                  size="icon"
                  className="hidden rounded-full md:inline-flex"
                >
                  <Plus className="size-5" strokeWidth={2} aria-hidden="true" />
                </Button>
              ) : null}
            </div>
          </div>

          {searchEnabled ? (
            <div className="relative">
              <Search
                className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-ink-muted-48"
                aria-hidden="true"
                strokeWidth={2}
              />
              <Input
                type="search"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search tasks…"
                aria-label="Search tasks"
                className="h-11 rounded-xl pl-9 text-[15px] md:text-[15px]"
              />
            </div>
          ) : null}

          {emptyState === "no-results" ? (
            <EmptyPanel
              title="No Tasks Found"
              description="Try changing your search or filters."
            />
          ) : null}

          {emptyState === "ready" ? (
            <div className="space-y-8">
              <ul className="grid list-none grid-cols-2 gap-x-5 gap-y-9 sm:grid-cols-3 sm:gap-x-6 lg:grid-cols-4">
                {filteredTasks.map((task) => (
                  <TaskRow
                    key={task.id}
                    task={task}
                    timeZone={timeZone}
                    timeFormat={timeFormat}
                    tone={resolveTaskTone(task, now)}
                    courseIcon={courseIconById.get(task.course_id)}
                  />
                ))}
              </ul>
            </div>
          ) : null}
        </div>
      ) : null}

      {pager}

      {emptyState === "no-courses" ? (
        <EmptyPanel
          title="No Courses Yet"
          description="Create a course first to start adding tasks."
          action={
            <Button
              nativeButton={false}
              render={<Link href="/courses" />}
              className="min-h-11 w-full rounded-full px-5 sm:w-auto"
            >
              Create course
            </Button>
          }
        />
      ) : null}

      {emptyState === "no-tasks" ? (
        <EmptyPanel
          title="No Tasks Yet"
          description="Add a task to start tracking your deadlines."
          action={
            <Button
              type="button"
              onClick={openAdd}
              className="min-h-11 w-full rounded-full px-5 sm:w-auto"
            >
              Add task
            </Button>
          }
        />
      ) : null}

      {hasCourses ? (
        <Button
          type="button"
          onClick={openAdd}
          aria-label="Add task"
          className="fixed right-4 bottom-[max(1.25rem,env(safe-area-inset-bottom))] z-40 size-14 rounded-full p-0 shadow-lg md:hidden"
        >
          <Plus className="size-5" strokeWidth={2} aria-hidden="true" />
        </Button>
      ) : null}

      <Dialog
        open={addOpen}
        onOpenChange={setAddOpen}
        title={hasCourses ? "Add task" : "No courses yet"}
      >
        {hasCourses ? (
          <div className="w-full text-left">
            <AddTaskForm
              courses={courses}
              timeZone={timeZone}
              returnTo="/tasks"
              onCancel={() => setAddOpen(false)}
            />
          </div>
        ) : (
          <div className="w-full space-y-4 text-left">
            <p className="text-[15px] leading-relaxed text-ink-muted-48">
              Create a course first to start adding tasks.
            </p>
            <Button
              nativeButton={false}
              render={<Link href="/courses" />}
              className="min-h-11 w-full rounded-full px-5"
            >
              Create course
            </Button>
          </div>
        )}
      </Dialog>
    </section>
  );
}
