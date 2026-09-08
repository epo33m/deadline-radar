import Link from "next/link";
import { ChevronRight, MoreHorizontal } from "lucide-react";

import type { OverviewSummaries } from "@/lib/overview/summaries";
import { cn } from "@/lib/utils";

import { OverviewCard } from "./overview-card";
import { TaskSummaryList } from "./task-summary-list";

type OverviewSummariesProps = {
  summaries: OverviewSummaries;
  timeZone: string;
};

type SectionTone = "all" | "overdue" | "due-soon" | "completed";

const SECTION_CARD_CLASS: Record<SectionTone, string> = {
  all: "overview-section-all",
  overdue: "overview-section-overdue",
  "due-soon": "overview-section-due-soon",
  completed: "overview-section-completed",
};

function SummarySection({
  title,
  viewAllHref,
  viewAllLabel,
  tone,
  hasTasks,
  className,
  children,
}: {
  title: string;
  viewAllHref?: string;
  viewAllLabel?: string;
  tone: SectionTone;
  hasTasks: boolean;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <OverviewCard
      as="section"
      className={cn("flex h-full flex-col", SECTION_CARD_CLASS[tone], className)}
    >
      <div className="flex flex-1 flex-col space-y-4">
        <div className="flex items-start justify-between gap-3">
          <h2 className="font-display text-lg font-semibold text-ink sm:text-xl">
            {title}
          </h2>
          {hasTasks ? (
            <button
              type="button"
              aria-label={`${title} section options`}
              className="inline-flex size-8 shrink-0 items-center justify-center rounded-lg text-ink-muted-48 transition-colors hover:bg-surface-pearl hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-focus"
            >
              <MoreHorizontal className="size-4" aria-hidden="true" />
            </button>
          ) : null}
        </div>
        {children}
        {hasTasks && viewAllHref && viewAllLabel ? (
          <Link
            href={viewAllHref}
            className="inline-flex items-center gap-1 text-sm text-primary hover:underline focus-visible:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-focus"
          >
            {viewAllLabel}
            <ChevronRight className="size-4" aria-hidden="true" />
          </Link>
        ) : null}
      </div>
    </OverviewCard>
  );
}

export function OverviewSummariesPanel({
  summaries,
  timeZone,
}: OverviewSummariesProps) {
  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-2 md:gap-5">
      <SummarySection
        title="All"
        viewAllHref="/tasks"
        viewAllLabel="View all tasks"
        tone="all"
        hasTasks={summaries.all.length > 0}
      >
        <TaskSummaryList
          tasks={summaries.all}
          emptyTone="all"
          timeZone={timeZone}
        />
      </SummarySection>

      <SummarySection
        title="Upcoming"
        viewAllHref="/tasks"
        viewAllLabel="View all upcoming tasks"
        tone="due-soon"
        hasTasks={summaries.approaching.length > 0}
      >
        <TaskSummaryList
          tasks={summaries.approaching}
          emptyTone="due-soon"
          timeZone={timeZone}
        />
      </SummarySection>

      <SummarySection
        title="Late"
        viewAllHref="/tasks"
        viewAllLabel="View all late tasks"
        tone="overdue"
        hasTasks={summaries.overdue.length > 0}
      >
        <TaskSummaryList
          tasks={summaries.overdue}
          emptyTone="overdue"
          timeZone={timeZone}
        />
      </SummarySection>

      <SummarySection
        title="Done"
        viewAllHref="/tasks"
        viewAllLabel="View task history"
        tone="completed"
        hasTasks={summaries.recentlyCompleted.length > 0}
      >
        <TaskSummaryList
          tasks={summaries.recentlyCompleted}
          emptyTone="completed"
          timeZone={timeZone}
          showCompletedAt
        />
      </SummarySection>
    </div>
  );
}
