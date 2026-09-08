import { cn } from "@/lib/utils";

type StatusPillProps = {
  children: React.ReactNode;
  tone: "overdue" | "due-soon" | "completed";
  className?: string;
};

const TONE_CLASS: Record<StatusPillProps["tone"], string> = {
  overdue: "bg-destructive/10 text-destructive",
  "due-soon": "bg-warning/10 text-warning",
  completed: "bg-success/10 text-success",
};

export function StatusPill({ children, tone, className }: StatusPillProps) {
  return (
    <span
      className={cn(
        "inline-flex shrink-0 rounded-full px-2.5 py-0.5 text-xs font-medium",
        TONE_CLASS[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}
