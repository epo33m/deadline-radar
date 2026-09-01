import Link from "next/link";

import { formatDeadlineDate } from "@/lib/datetime";
import type { DashboardTask } from "@/lib/dashboard/summaries";

type UpcomingDeadlinesPanelProps = {
  tasks: DashboardTask[];
  timeZone: string;
  limit?: number;
};

export function UpcomingDeadlinesPanel({
  tasks,
  timeZone,
  limit = 5,
}: UpcomingDeadlinesPanelProps) {
  const upcoming = tasks.slice(0, limit);

  return (
    <section className="space-y-3">
      <div className="space-y-1">
        <h2 className="font-display text-lg font-semibold text-ink">
          Upcoming next 7 days
        </h2>
      </div>

      {upcoming.length === 0 ? (
        <p className="text-sm text-ink-muted-48">No upcoming deadlines.</p>
      ) : (
        <ul className="space-y-2 border-t border-hairline pt-2">
          {upcoming.map((task) => (
            <li
              key={task.id}
              className="flex items-start justify-between gap-3 border-b border-hairline py-2 last:border-b-0"
            >
              <Link
                href={`/tasks/${task.id}`}
                className="min-w-0 truncate text-sm font-medium text-ink hover:text-primary"
              >
                {task.title}
              </Link>
              <span className="shrink-0 text-sm text-ink-muted-48">
                {formatDeadlineDate(task.deadline, timeZone)}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
