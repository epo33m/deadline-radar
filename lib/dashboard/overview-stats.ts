import {
  categorizeDashboardTasks,
  type DashboardTask,
} from "@/lib/dashboard/summaries";

export type { DashboardTask };

export type OverviewStats = {
  overdue: number;
  dueThisWeek: number;
  completedThisWeek: number;
  totalTasks: number;
};

export function computeOverviewStats(
  tasks: DashboardTask[],
  now: Date = new Date(),
): OverviewStats {
  const summaries = categorizeDashboardTasks(tasks, now);

  return {
    overdue: summaries.overdue.length,
    dueThisWeek: summaries.approaching.length,
    completedThisWeek: summaries.recentlyCompleted.length,
    totalTasks: tasks.length,
  };
}
