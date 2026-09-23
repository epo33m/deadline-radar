"use client";

import { CheckCircle2, Circle, CircleDot, type LucideIcon } from "lucide-react";

import { cn } from "@/lib/utils";
import type { TaskStatus } from "@/lib/validation/task";

const STATUS_STEPS: { value: TaskStatus; label: string; icon: LucideIcon }[] =
  [
    { value: "todo", label: "To do", icon: Circle },
    { value: "in_progress", label: "In progress", icon: CircleDot },
    { value: "done", label: "Complete", icon: CheckCircle2 },
  ];

/** Reached line segments follow the active status dot color. */
const STATUS_LINE_CLASS: Record<TaskStatus, string> = {
  todo: "bg-ink",
  in_progress: "bg-warning",
  done: "bg-success",
};

/** Reached step icons follow the active status dot color. */
const STATUS_ICON_CLASS: Record<TaskStatus, string> = {
  todo: "text-ink",
  in_progress: "text-warning",
  done: "text-success",
};

export function StatusSteps({ status }: { status: TaskStatus }) {
  const currentIndex = Math.max(
    0,
    STATUS_STEPS.findIndex((step) => step.value === status),
  );

  return (
    <ol aria-label="Task progress" className="flex">
      {STATUS_STEPS.map((step, index) => {
        const completed = index < currentIndex;
        const current = index === currentIndex;
        const reached = index <= currentIndex;
        const isFirst = index === 0;
        const isLast = index === STATUS_STEPS.length - 1;
        const Icon = step.icon;
        return (
          <li
            key={step.value}
            aria-current={current ? "step" : undefined}
            className="min-w-0 flex-1"
          >
            <div aria-hidden="true" className="flex items-center">
              <span
                className={cn(
                  "h-0.5 flex-1",
                  isFirst
                    ? "bg-transparent"
                    : reached
                      ? STATUS_LINE_CLASS[status]
                      : "bg-ink/20",
                )}
              />
              <Icon
                strokeWidth={2}
                className={cn(
                  "size-4 shrink-0",
                  reached ? STATUS_ICON_CLASS[status] : "text-ink/30",
                )}
              />
              <span
                className={cn(
                  "h-0.5 flex-1",
                  isLast
                    ? "bg-transparent"
                    : completed
                      ? STATUS_LINE_CLASS[status]
                      : "bg-ink/20",
                )}
              />
            </div>
            <p
              className={cn(
                "mt-2 truncate text-center text-[13px] leading-snug",
                current ? "font-semibold text-ink" : "text-ink-muted-48",
              )}
            >
              {step.label}
            </p>
            <span className="sr-only">
              {completed
                ? `Completed: ${step.label}`
                : current
                  ? `Current step: ${step.label}`
                  : `Upcoming: ${step.label}`}
            </span>
          </li>
        );
      })}
    </ol>
  );
}
