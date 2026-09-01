import { cn } from "@/lib/utils";

type OverviewCardProps = {
  children: React.ReactNode;
  className?: string;
  as?: "div" | "section";
};

/** store-utility-card — DESIGN.md: rounded-lg, hairline border, canvas bg, 24px padding */
export function OverviewCard({
  children,
  className,
  as: Tag = "div",
}: OverviewCardProps) {
  return (
    <Tag
      className={cn(
        "rounded-lg border border-hairline/80 p-4 shadow-none sm:p-6",
        className,
      )}
    >
      {children}
    </Tag>
  );
}
