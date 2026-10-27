"use client";

import { DESCRIPTION_MAX_LENGTH } from "@deadline-radar/validation";
import { cn } from "@/lib/utils";

export function DescriptionField({
  id,
  name,
  value,
  onChange,
  placeholder = "Notes",
  rows = 3,
  error,
  className,
}: {
  id: string;
  name: string;
  value: string;
  onChange: (next: string) => void;
  placeholder?: string;
  rows?: number;
  error?: boolean;
  className?: string;
}) {
  const remaining = DESCRIPTION_MAX_LENGTH - value.length;
  const showCounter = remaining <= 200;

  return (
    <div className={cn("w-full", className)}>
      <textarea
        id={id}
        name={name}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        rows={rows}
        maxLength={DESCRIPTION_MAX_LENGTH}
        aria-invalid={error ? true : undefined}
        className="w-full rounded-none border-0 bg-transparent px-0 py-1 pr-8 font-sans text-[15px] font-normal leading-normal tracking-[-0.2px] text-ink shadow-none outline-none placeholder:text-ink-muted-48 focus-visible:border-0 focus-visible:ring-0 focus-visible:outline-none aria-invalid:text-destructive"
      />
      {showCounter ? (
        <p
          aria-live="polite"
          className={cn(
            "mt-1 text-right text-xs tabular-nums",
            remaining < 50 ? "text-destructive" : "text-ink-muted-48",
          )}
        >
          {remaining} characters left
        </p>
      ) : null}
    </div>
  );
}