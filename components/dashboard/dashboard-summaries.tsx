import {
  APPROACHING_WINDOW_DAYS,
  RECENTLY_COMPLETED_WINDOW_DAYS,
  type DashboardSummaries,
} from "@/lib/dashboard/summaries";

import { TaskSummaryList } from "./task-summary-list";

type DashboardSummariesProps = {
  summaries: DashboardSummaries;
};

function SummarySection({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <section className="space-y-3">
      <div className="space-y-1">
        <h2 className="font-display text-xl font-semibold">{title}</h2>
        <p className="text-sm text-ink-muted-48">{description}</p>
      </div>
      {children}
    </section>
  );
}

export function DashboardSummariesPanel({ summaries }: DashboardSummariesProps) {
  return (
    <div className="space-y-10">
      <SummarySection
        title="Overdue"
        description="Active tasks past their deadline."
      >
        <TaskSummaryList
          tasks={summaries.overdue}
          emptyMessage="No overdue tasks."
        />
      </SummarySection>

      <SummarySection
        title="Approaching deadline"
        description={`Active tasks due within the next ${APPROACHING_WINDOW_DAYS} days.`}
      >
        <TaskSummaryList
          tasks={summaries.approaching}
          emptyMessage="No tasks due in the next week."
        />
      </SummarySection>

      <SummarySection
        title="Recently completed"
        description={`Tasks marked done in the last ${RECENTLY_COMPLETED_WINDOW_DAYS} days.`}
      >
        <TaskSummaryList
          tasks={summaries.recentlyCompleted}
          emptyMessage="No recently completed tasks."
          showCompletedAt
        />
      </SummarySection>
    </div>
  );
}
