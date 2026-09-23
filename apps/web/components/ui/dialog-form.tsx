"use client";

import type { ReactNode } from "react";

import { formCardClassName } from "@/components/ui/form-layout";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

export {
  formActionGapClassName,
  formCardClassName,
  formSectionGapClassName,
  formTitleGapClassName,
} from "@/components/ui/form-layout";

/** Field card with subtle row separators, used by all dialog forms. */
export const dialogFormListClassName = cn(
  "w-full list-none divide-y divide-divider-soft text-left",
  formCardClassName,
);

export const dialogFormRowClassName =
  "grid grid-cols-[10rem_minmax(0,1fr)] items-center gap-x-4 py-1.5";

/** Borderless trailing-aligned field base (overrides shared Input/select chrome). */
export const dialogInputClassName = cn(
  "h-11 w-full min-w-0 rounded-none border-0 bg-transparent px-0 py-0 pr-2 font-sans text-[15px] font-normal leading-normal tracking-[-0.2px] text-right text-ink shadow-none outline-none placeholder:text-ink-muted-48 focus-visible:border-0 focus-visible:ring-0 focus-visible:outline-none disabled:opacity-50 disabled:bg-transparent dark:bg-transparent aria-invalid:border-0 aria-invalid:ring-0 aria-invalid:text-destructive",
);

/** Borderless select-style trigger (value + chevron), like the timezone trigger. */
export const dialogSelectClassName = cn(
  dialogInputClassName,
  "cursor-pointer text-ink-muted-80",
);

/** A form row: label (title) on the far left, control on the far right. */
export function DialogFormRow({
  label,
  htmlFor,
  children,
}: {
  label: string;
  htmlFor?: string;
  children: ReactNode;
}) {
  return (
    <li className={dialogFormRowClassName}>
      <Label
        htmlFor={htmlFor}
        className="text-[15px] font-medium leading-snug tracking-[-0.2px] text-ink"
      >
        {label}
      </Label>
      <div className="w-full min-w-0">{children}</div>
    </li>
  );
}