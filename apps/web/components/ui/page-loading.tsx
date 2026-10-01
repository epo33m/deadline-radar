import { Loader2 } from "lucide-react";

import { cn } from "@/lib/utils";

export type PageLoadingProps = {
  title?: string;
  className?: string;
};

export function PageLoading({
  title = "Loading…",
  className,
}: PageLoadingProps) {
  return (
    <div
      role="status"
      aria-live="polite"
      aria-busy="true"
      aria-label={title}
      className={cn(
        "fixed inset-0 z-50 flex flex-col items-center justify-center bg-canvas/80 p-4 backdrop-blur-[3px] animate-in fade-in duration-150",
        className,
      )}
    >
      <div className="flex flex-col items-center gap-3 text-center">
        <Loader2
          className="size-10 animate-spin text-primary"
          aria-hidden="true"
        />
        {title ? (
          <p className="font-display text-[17px] font-medium tracking-[-0.2px] text-ink">
            {title}
          </p>
        ) : null}
      </div>
    </div>
  );
}
