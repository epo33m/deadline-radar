import {
  Calendar,
  CheckCircle2,
  ClockAlert,
  ListTodo,
  type LucideIcon,
} from "lucide-react";

export type SectionTone = "all" | "overdue" | "due-soon" | "completed";

const EMPTY_STATE_ICONS: Record<SectionTone, LucideIcon> = {
  all: ListTodo,
  overdue: ClockAlert,
  "due-soon": Calendar,
  completed: CheckCircle2,
};

const EMPTY_STATE_ICON_COLOR: Record<SectionTone, string> = {
  all: "#7a7a7a",
  overdue: "#ff3b30",
  "due-soon": "#ff9500",
  completed: "#34c759",
};

const EMPTY_STATE_TITLE: Record<SectionTone, string> = {
  all: "No tasks",
  overdue: "All caught up",
  "due-soon": "Nothing due soon",
  completed: "Nothing yet",
};

type SectionEmptyStateProps = {
  tone: SectionTone;
};

export function SectionEmptyState({ tone }: SectionEmptyStateProps) {
  const Icon = EMPTY_STATE_ICONS[tone];
  const title = EMPTY_STATE_TITLE[tone];

  return (
    <div className="flex flex-col items-center px-2 py-8 text-center sm:px-4 sm:py-12">
      <Icon
        color={EMPTY_STATE_ICON_COLOR[tone]}
        className="mb-3 size-12 shrink-0 sm:mb-4 sm:size-16"
        aria-hidden="true"
        strokeWidth={1.5}
      />
      <p className="font-display text-base font-semibold text-ink">{title}</p>
    </div>
  );
}
