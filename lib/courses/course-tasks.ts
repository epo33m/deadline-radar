import type { TaskStatus } from "@/lib/validation/task";

/** Match the dashboard approaching window for “due this week”. */
export const DUE_THIS_WEEK_DAYS = 7;

const MS_PER_DAY = 24 * 60 * 60 * 1000;

export type CourseTask = {
  id: string;
  title: string;
  deadline: string;
  status: TaskStatus;
};

export type CourseTaskSummary = {
  overdue: number;
  dueThisWeek: number;
  completed: number;
};

function deadlineMs(task: CourseTask): number | null {
  const ms = new Date(task.deadline).getTime();
  return Number.isNaN(ms) ? null : ms;
}

function compareByDeadline(a: CourseTask, b: CourseTask): number {
  return (deadlineMs(a) ?? 0) - (deadlineMs(b) ?? 0);
}

/**
 * Active work first (overdue, then nearest deadline), then done tasks.
 * Tasks with invalid deadlines stay with active work, after dated items.
 */
export function orderCourseTasks<T extends CourseTask>(
  tasks: T[],
  now: Date = new Date(),
): T[] {
  const nowMs = now.getTime();
  const overdue: T[] = [];
  const upcoming: T[] = [];
  const undated: T[] = [];
  const done: T[] = [];

  for (const task of tasks) {
    if (task.status === "done") {
      done.push(task);
      continue;
    }

    const ms = deadlineMs(task);
    if (ms === null) {
      undated.push(task);
      continue;
    }

    if (ms < nowMs) {
      overdue.push(task);
    } else {
      upcoming.push(task);
    }
  }

  overdue.sort(compareByDeadline);
  upcoming.sort(compareByDeadline);
  done.sort(compareByDeadline);

  return [...overdue, ...upcoming, ...undated, ...done];
}

export function summarizeCourseTasks(
  tasks: CourseTask[],
  now: Date = new Date(),
): CourseTaskSummary {
  const nowMs = now.getTime();
  const weekCutoffMs = nowMs + DUE_THIS_WEEK_DAYS * MS_PER_DAY;

  let overdue = 0;
  let dueThisWeek = 0;
  let completed = 0;

  for (const task of tasks) {
    if (task.status === "done") {
      completed += 1;
      continue;
    }

    const ms = deadlineMs(task);
    if (ms === null) continue;

    if (ms < nowMs) {
      overdue += 1;
    } else if (ms <= weekCutoffMs) {
      dueThisWeek += 1;
    }
  }

  return { overdue, dueThisWeek, completed };
}
