"use client";

import Link from "next/link";
import { Check, CheckSquare, Circle, Plus, Search } from "lucide-react";
import { useMemo, useState, type ReactNode } from "react";

import { AddTaskForm } from "@/components/tasks/task-form";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { formatDeadline } from "@/lib/datetime";
import { formatRelativeDeadline } from "@/lib/deadline-relative";
import {
  filterTasksByStatusView,
  groupTasksByHorizon,
  resolveTasksEmptyState,
  type TaskHorizonGroups,
  type TasksStatusView,
} from "@/lib/tasks/global-tasks";
import { cn } from "@/lib/utils";
import type { CourseListItem } from "@/types/course";
import type { TaskListItem } from "@/types/task";

/** Show search once the collection is large enough to justify it (UX-008). */
const SEARCH_MIN_TASKS = 8;

const STATUS_VIEWS: { id: TasksStatusView; label: string }[] = [
  { id: "all", label: "All" },
  { id: "upcoming", label: "Upcoming" },
  { id: "late", label: "Late" },
  { id: "done", label: "Done" },
];

type RowTone = "late" | "upcoming" | "done";

const TONE_ICON_CLASS: Record<Exclude<RowTone, "done">, string> = {
  late: "text-destructive",
  upcoming: "text-warning",
};

const TONE_RELATIVE_CLASS: Record<RowTone, string> = {
  late: "text-destructive",
  upcoming: "text-ink-muted-80",
  done: "text-ink-muted-48",
};

const TONE_TITLE_CLASS: Record<RowTone, string> = {
  late: "text-destructive",
  upcoming: "text-warning",
  done: "text-ink-muted-48",
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
};

function matchesSearch(task: TaskListItem, query: string): boolean {
  if (!query) return true;
  const haystack = `${task.title} ${task.course_name ?? ""}`.toLowerCase();
  return haystack.includes(query);
}

function TaskRow({
  task,
  timeZone,
  tone,
}: {
  task: TaskListItem;
  timeZone: string;
  tone: RowTone;
}) {
  const completed = tone === "done";
  const relativeLabel = completed
    ? "Completed"
    : formatRelativeDeadline(task.deadline, timeZone);
  const metaLine = completed
    ? `${task.course_name ?? "Course"} · Completed ${formatDeadline(task.deadline, timeZone)}`
    : `${task.course_name ?? "Course"} · Due ${formatDeadline(task.deadline, timeZone)}`;

  return (
    <li className="border-b border-hairline last:border-b-0">
      <Link
        href={`/tasks/${task.id}`}
        className="flex min-h-12 w-full items-start gap-3 py-3.5 outline-none transition-colors hover:bg-muted/40 focus-visible:bg-muted/40 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset sm:gap-3.5 sm:py-4"
      >
        <span className="mt-0.5 shrink-0" aria-hidden="true">
          {completed ? (
            <Check className="size-5 text-success" strokeWidth={2.25} />
          ) : (
            <Circle
              className={cn(
                "size-5",
                tone === "late"
                  ? TONE_ICON_CLASS.late
                  : TONE_ICON_CLASS.upcoming,
              )}
              strokeWidth={2}
            />
          )}
        </span>
        <span className="sr-only">{TONE_INDICATOR_LABEL[tone]}. </span>
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
            TONE_RELATIVE_CLASS[tone],
          )}
        >
          {relativeLabel}
        </p>
        <span className="sr-only">Open {task.title}</span>
      </Link>
    </li>
  );
}

function TaskGroup({
  title,
  tone,
  tasks,
  timeZone,
}: {
  title: string;
  tone: RowTone;
  tasks: TaskListItem[];
  timeZone: string;
}) {
  if (tasks.length === 0) return null;

  return (
    <section className="space-y-2" aria-label={title}>
      <h3
        className={cn(
          "font-display text-[13px] font-semibold tracking-[0.06em] uppercase sm:text-sm",
          TONE_TITLE_CLASS[tone],
        )}
      >
        {title}
      </h3>
      <ul className="list-none border-t border-hairline">
        {tasks.map((task) => (
          <TaskRow
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

function HorizonGroups({
  horizons,
  timeZone,
}: {
  horizons: TaskHorizonGroups<TaskListItem>;
  timeZone: string;
}) {
  return (
    <>
      <TaskGroup
        title="Today"
        tone="upcoming"
        tasks={horizons.today}
        timeZone={timeZone}
      />
      <TaskGroup
        title="Upcoming"
        tone="upcoming"
        tasks={horizons.upcoming}
        timeZone={timeZone}
      />
      <TaskGroup
        title="Later"
        tone="upcoming"
        tasks={horizons.later}
        timeZone={timeZone}
      />
    </>
  );
}

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
}: TasksCollectionProps) {
  const [view, setView] = useState<TasksStatusView>("all");
  const [query, setQuery] = useState("");
  const [addOpen, setAddOpen] = useState(false);

  const normalizedQuery = query.trim().toLowerCase();
  const searchEnabled =
    tasks.length >= SEARCH_MIN_TASKS || normalizedQuery.length > 0;

  const searchedTasks = useMemo(
    () =>
      searchEnabled
        ? tasks.filter((task) => matchesSearch(task, normalizedQuery))
        : tasks,
    [tasks, normalizedQuery, searchEnabled],
  );

  const lateTasks = useMemo(
    () => filterTasksByStatusView(searchedTasks, "late"),
    [searchedTasks],
  );
  const upcomingOpenTasks = useMemo(
    () => filterTasksByStatusView(searchedTasks, "upcoming"),
    [searchedTasks],
  );
  const doneTasks = useMemo(
    () => filterTasksByStatusView(searchedTasks, "done"),
    [searchedTasks],
  );

  const filteredTasks =
    view === "all"
      ? searchedTasks
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

  const horizons = useMemo(
    () => groupTasksByHorizon(upcomingOpenTasks, timeZone),
    [upcomingOpenTasks, timeZone],
  );

  const openAdd = () => setAddOpen(true);
  const showChrome = emptyState !== "no-courses" && emptyState !== "no-tasks";
  const hasCourses = courses.length > 0;

  return (
    <section className="space-y-6 sm:space-y-8">
      <header className="flex items-start justify-between gap-3 sm:gap-4">
        <div className="min-w-0 flex-1 space-y-2 sm:space-y-3">
          <h1 className="font-display text-[32px] font-semibold leading-[1.07] tracking-[-0.28px] text-ink sm:text-[36px] lg:text-[44px]">
            Tasks
          </h1>
          <p className="max-w-xl text-[15px] font-normal leading-[1.47] tracking-[-0.374px] text-ink-muted-48 sm:text-[17px]">
            Track deadlines across every course.
          </p>
        </div>

        {hasCourses ? (
          <Button
            type="button"
            onClick={openAdd}
            aria-label="Add task"
            className="mt-0.5 hidden size-11 shrink-0 rounded-full p-0 md:inline-flex"
          >
            <Plus className="size-5" strokeWidth={2} aria-hidden="true" />
          </Button>
        ) : null}
      </header>

      {showChrome ? (
        <div
          className={
            emptyState === "ready" || emptyState === "no-results"
              ? "space-y-4 pb-20 sm:space-y-5 md:pb-0"
              : "space-y-4"
          }
        >
          <h2 className="font-display text-[19px] font-semibold tracking-[-0.2px] text-ink sm:text-[21px]">
            My Tasks
          </h2>

          <div
            role="group"
            aria-label="Task status"
            className="flex flex-wrap gap-1.5"
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
              {view === "all" ? (
                <>
                  <TaskGroup
                    title="Late"
                    tone="late"
                    tasks={lateTasks}
                    timeZone={timeZone}
                  />
                  <HorizonGroups horizons={horizons} timeZone={timeZone} />
                  <TaskGroup
                    title="Done"
                    tone="done"
                    tasks={doneTasks}
                    timeZone={timeZone}
                  />
                </>
              ) : null}

              {view === "upcoming" ? (
                <HorizonGroups horizons={horizons} timeZone={timeZone} />
              ) : null}

              {view === "late" ? (
                <TaskGroup
                  title="Late"
                  tone="late"
                  tasks={filteredTasks}
                  timeZone={timeZone}
                />
              ) : null}

              {view === "done" ? (
                <TaskGroup
                  title="Done"
                  tone="done"
                  tasks={filteredTasks}
                  timeZone={timeZone}
                />
              ) : null}

              <p className="pb-2 text-center text-sm text-ink-muted-48">
                That&apos;s all for now.
              </p>
            </div>
          ) : null}
        </div>
      ) : null}

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
