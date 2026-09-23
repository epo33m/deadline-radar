import type { TaskStatus } from "@/lib/validation/task";

export type CourseTask = {
  id: string;
  title: string;
  deadline: string;
  status: TaskStatus;
};

export type CourseTaskGroups<T extends CourseTask = CourseTask> = {
  late: T[];
  upcoming: T[];
  done: T[];
};

export type CourseTaskStatusGroups<T extends CourseTask = CourseTask> = {
  todo: T[];
  in_progress: T[];
  done: T[];
};

export type CourseDetailSummary = {
  total: number;
  late: number;
  upcoming: number;
  done: number;
};

function deadlineMs(task: CourseTask): number | null {
  const ms = new Date(task.deadline).getTime();
  return Number.isNaN(ms) ? null : ms;
}

function compareByDeadline(a: CourseTask, b: CourseTask): number {
  return (deadlineMs(a) ?? 0) - (deadlineMs(b) ?? 0);
}

/**
 * Split course tasks into Late / Upcoming / Done for Course Detail.
 * Invalid deadlines stay with Upcoming after dated items.
 */
export function groupCourseTasks<T extends CourseTask>(
  tasks: T[],
  now: Date = new Date(),
): CourseTaskGroups<T> {
  const nowMs = now.getTime();
  const late: T[] = [];
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
      late.push(task);
    } else {
      upcoming.push(task);
    }
  }

  late.sort(compareByDeadline);
  upcoming.sort(compareByDeadline);
  done.sort(compareByDeadline);

  return { late, upcoming: [...upcoming, ...undated], done };
}

/**
 * Split course tasks into To do / In progress / Done by task status.
 */
export function groupCourseTasksByStatus<T extends CourseTask>(
  tasks: T[],
): CourseTaskStatusGroups<T> {
  const todo: T[] = [];
  const in_progress: T[] = [];
  const done: T[] = [];

  for (const task of tasks) {
    if (task.status === "done") {
      done.push(task);
    } else if (task.status === "in_progress") {
      in_progress.push(task);
    } else {
      todo.push(task);
    }
  }

  todo.sort(compareByDeadline);
  in_progress.sort(compareByDeadline);
  done.sort(compareByDeadline);

  return { todo, in_progress, done };
}

export function summarizeCourseDetail(
  tasks: CourseTask[],
  now: Date = new Date(),
): CourseDetailSummary {
  const groups = groupCourseTasks(tasks, now);
  return {
    total: tasks.length,
    late: groups.late.length,
    upcoming: groups.upcoming.length,
    done: groups.done.length,
  };
}

/** Lightweight secondary line: `12 Tasks · 3 Upcoming · 2 Done`. */
export function formatCourseDetailSummaryLine(
  summary: CourseDetailSummary,
): string | null {
  if (summary.total === 0) return null;

  const parts = [
    `${summary.total} ${summary.total === 1 ? "Task" : "Tasks"}`,
    `${summary.upcoming} Upcoming`,
    `${summary.done} Done`,
  ];

  if (summary.late > 0) {
    parts.splice(1, 0, `${summary.late} Overdue`);
  }

  return parts.join(" · ");
}
