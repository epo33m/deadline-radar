import { getZonedDayKey } from "@/lib/calendar/month";
import { APPROACHING_WINDOW_DAYS } from "@/lib/overview/summaries";
import type { TaskStatus } from "@/lib/validation/task";

export type TasksStatusView = "all" | "upcoming" | "late" | "done";

export type GlobalTask = {
  id: string;
  title: string;
  deadline: string;
  status: TaskStatus;
};

export type TaskHorizonGroups<T extends GlobalTask = GlobalTask> = {
  today: T[];
  upcoming: T[];
  later: T[];
};

const MS_PER_DAY = 24 * 60 * 60 * 1000;

function deadlineMs(task: GlobalTask): number | null {
  const ms = new Date(task.deadline).getTime();
  return Number.isNaN(ms) ? null : ms;
}

function compareByDeadline(a: GlobalTask, b: GlobalTask): number {
  return (
    (deadlineMs(a) ?? Number.POSITIVE_INFINITY) -
    (deadlineMs(b) ?? Number.POSITIVE_INFINITY)
  );
}

function dayKeyToUtcMs(dayKey: string): number {
  const [year, month, day] = dayKey.split("-").map(Number);
  return Date.UTC(year, month - 1, day);
}

function diffCalendarDays(
  deadlineIso: string,
  now: Date,
  timeZone: string,
): number | null {
  const deadlineKey = getZonedDayKey(deadlineIso, timeZone);
  const nowKey = getZonedDayKey(now.toISOString(), timeZone);
  if (!deadlineKey || !nowKey) return null;

  return Math.round(
    (dayKeyToUtcMs(deadlineKey) - dayKeyToUtcMs(nowKey)) / MS_PER_DAY,
  );
}

/**
 * Filter the global task collection by status view.
 * Upcoming includes open tasks with invalid deadlines (sorted last).
 */
export function filterTasksByStatusView<T extends GlobalTask>(
  tasks: T[],
  view: TasksStatusView,
  now: Date = new Date(),
): T[] {
  const nowMs = now.getTime();
  const filtered = tasks.filter((task) => {
    if (view === "all") return true;
    if (view === "done") return task.status === "done";
    if (task.status === "done") return false;

    const ms = deadlineMs(task);
    if (view === "late") {
      return ms !== null && ms < nowMs;
    }

    // upcoming
    return ms === null || ms >= nowMs;
  });

  return [...filtered].sort(compareByDeadline);
}

/**
 * Group open tasks into Today / Upcoming / Later by calendar day in `timeZone`.
 * Upcoming is due within the next APPROACHING_WINDOW_DAYS (inclusive of day 7).
 * Done tasks are omitted. Invalid deadlines land in Later.
 * Callers should pass non-late open tasks (e.g. status view "upcoming").
 */
export function groupTasksByHorizon<T extends GlobalTask>(
  tasks: T[],
  timeZone: string,
  now: Date = new Date(),
): TaskHorizonGroups<T> {
  const today: T[] = [];
  const upcoming: T[] = [];
  const later: T[] = [];

  for (const task of tasks) {
    if (task.status === "done") continue;

    const diff = diffCalendarDays(task.deadline, now, timeZone);
    if (diff === null) {
      later.push(task);
      continue;
    }

    if (diff === 0) {
      today.push(task);
    } else if (diff > 0 && diff <= APPROACHING_WINDOW_DAYS) {
      upcoming.push(task);
    } else {
      // Beyond the window, undated, or past-due (callers should filter late first).
      later.push(task);
    }
  }

  today.sort(compareByDeadline);
  upcoming.sort(compareByDeadline);
  later.sort(compareByDeadline);

  return { today, upcoming, later };
}

export type TasksEmptyState =
  | "no-courses"
  | "no-tasks"
  | "no-results"
  | "ready";

/** Decide which empty / ready state the Tasks page should show. */
export function resolveTasksEmptyState(input: {
  courseCount: number;
  taskCount: number;
  filteredCount: number;
}): TasksEmptyState {
  if (input.courseCount === 0) return "no-courses";
  if (input.taskCount === 0) return "no-tasks";
  if (input.filteredCount === 0) return "no-results";
  return "ready";
}
