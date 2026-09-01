import type { OverviewStats } from "@/lib/dashboard/overview-stats";

const STAT_ITEMS: {
  key: keyof OverviewStats;
  label: string;
  description: string;
}[] = [
  {
    key: "overdue",
    label: "Overdue",
    description: "Tasks need your attention",
  },
  {
    key: "dueThisWeek",
    label: "Due this week",
    description: "Tasks due within 7 days",
  },
  {
    key: "completedThisWeek",
    label: "Completed this week",
    description: "Tasks you've finished",
  },
  {
    key: "totalTasks",
    label: "Total tasks",
    description: "Across all courses",
  },
];

export function OverviewStatsGrid({ stats }: { stats: OverviewStats }) {
  return (
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
      {STAT_ITEMS.map((item) => (
        <div
          key={item.key}
          className="rounded-xl border border-hairline bg-canvas px-4 py-4"
        >
          <p className="text-sm text-ink-muted-48">{item.label}</p>
          <p className="mt-1 font-display text-3xl font-semibold text-ink">
            {stats[item.key]}
          </p>
          <p className="mt-1 text-sm text-ink-muted-48">{item.description}</p>
        </div>
      ))}
    </div>
  );
}
