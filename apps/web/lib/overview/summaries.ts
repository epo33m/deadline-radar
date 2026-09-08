import type { TaskStatus } from "@/lib/validation/task";

/** Match the default H-7 reminder horizon for “approaching” tasks. */
export const APPROACHING_WINDOW_DAYS = 7;

/** How far back to show completed tasks on the overview. */
export const RECENTLY_COMPLETED_WINDOW_DAYS = 7;

const MS_PER_DAY = 24 * 60 * 60 * 1000;

export type OverviewTask = {
  id: string;
  title: string;
  deadline: string;
  status: TaskStatus;
  updated_at: string;
  course_name?: string | null;
  course_color?: string | null;
};

export type OverviewSummaries = {
  all: OverviewTask[];
  approaching: OverviewTask[];
  overdue: OverviewTask[];
  recentlyCompleted: OverviewTask[];
};

export function categorizeOverviewTasks(
  tasks: OverviewTask[],
  now: Date = new Date(),
): OverviewSummaries {
  const nowMs = now.getTime();
  const approachingCutoffMs = nowMs + APPROACHING_WINDOW_DAYS * MS_PER_DAY;
  const recentCutoffMs = nowMs - RECENTLY_COMPLETED_WINDOW_DAYS * MS_PER_DAY;

  const all: OverviewTask[] = [];
  const approaching: OverviewTask[] = [];
  const overdue: OverviewTask[] = [];
  const recentlyCompleted: OverviewTask[] = [];

  for (const task of tasks) {
    if (task.status === "done") {
      const updatedMs = new Date(task.updated_at).getTime();
      if (!Number.isNaN(updatedMs) && updatedMs >= recentCutoffMs) {
        recentlyCompleted.push(task);
      }
      continue;
    }

    const deadlineMs = new Date(task.deadline).getTime();
    if (Number.isNaN(deadlineMs)) {
      continue;
    }

    all.push(task);

    if (deadlineMs < nowMs) {
      overdue.push(task);
    } else if (deadlineMs <= approachingCutoffMs) {
      approaching.push(task);
    }
  }

  all.sort(
    (a, b) => new Date(a.deadline).getTime() - new Date(b.deadline).getTime(),
  );

  approaching.sort(
    (a, b) => new Date(a.deadline).getTime() - new Date(b.deadline).getTime(),
  );
  overdue.sort(
    (a, b) => new Date(a.deadline).getTime() - new Date(b.deadline).getTime(),
  );
  recentlyCompleted.sort(
    (a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime(),
  );

  return { all, approaching, overdue, recentlyCompleted };
}
