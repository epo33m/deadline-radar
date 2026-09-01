import Link from "next/link";

import {
  APPROACHING_WINDOW_DAYS,
  RECENTLY_COMPLETED_WINDOW_DAYS,
  type DashboardSummaries,
} from "@/lib/dashboard/summaries";

import { TaskSummaryList } from "./task-summary-list";

type DashboardSummariesProps = {
  summaries: DashboardSummaries;
  timeZone: string;
};

function SummarySection({
  title,
  description,
  viewAllHref,
  viewAllLabel,
  children,
}: {
  title: string;
  description: string;
  viewAllHref?: string;
  viewAllLabel?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="space-y-3">
      <div className="space-y-1">
        <h2 className="font-display text-xl font-semibold text-ink">{title}</h2>
        <p className="text-sm text-ink-muted-48">{description}</p>
      </div>
      {children}
      {viewAllHref && viewAllLabel ? (
        <Link
          href={viewAllHref}
          className="inline-flex text-sm text-primary hover:underline focus-visible:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-focus"
        >
          {viewAllLabel}
        </Link>
      ) : null}
    </section>
  );
}

export function DashboardSummariesPanel({
  summaries,
  timeZone,
}: DashboardSummariesProps) {
  return (
    <div className="space-y-10">
      <SummarySection
        title="Overdue"
        description="Tasks past their deadline."
        viewAllHref="/tasks"
        viewAllLabel="View all overdue tasks →"
      >
        <TaskSummaryList
          tasks={summaries.overdue}
          emptyMessage="No overdue tasks."
          timeZone={timeZone}
        />
      </SummarySection>

      <SummarySection
        title="Due soon"
        description={`Tasks due within the next ${APPROACHING_WINDOW_DAYS} days.`}
        viewAllHref="/tasks"
        viewAllLabel="View all upcoming tasks →"
      >
        <TaskSummaryList
          tasks={summaries.approaching}
          emptyMessage="No tasks due in the next week."
          timeZone={timeZone}
        />
      </SummarySection>

      <SummarySection
        title="Recently completed"
        description={`Tasks you've completed in the last ${RECENTLY_COMPLETED_WINDOW_DAYS} days.`}
      >
        <TaskSummaryList
          tasks={summaries.recentlyCompleted}
          emptyMessage="No recently completed tasks."
          timeZone={timeZone}
          showCompletedAt
          emphasizeRelative={false}
        />
      </SummarySection>
    </div>
  );
}
