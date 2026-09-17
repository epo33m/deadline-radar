"use client";

import { Check, ChevronsUpDown } from "lucide-react";
import { useId, useRef, useState } from "react";

import { PortalMenu } from "@/components/ui/portal-menu";
import { cn } from "@/lib/utils";
import type { TaskStatus } from "@/lib/validation/task";

type StatusPickerProps = {
  id?: string;
  value: TaskStatus;
  onChange: (value: TaskStatus) => void;
};

const STATUS_OPTIONS: { value: TaskStatus; label: string; dotClass: string }[] =
  [
    {
      value: "todo",
      label: "To do",
      dotClass: "bg-ink/30",
    },
    {
      value: "in_progress",
      label: "In progress",
      dotClass: "bg-warning",
    },
    {
      value: "done",
      label: "Done",
      dotClass: "bg-success",
    },
  ];

function StatusDot({ className }: { className: string }) {
  return (
    <span
      aria-hidden="true"
      className={cn("size-3 shrink-0 rounded-full", className)}
    />
  );
}

export function StatusPicker({
  id,
  value,
  onChange,
}: StatusPickerProps) {
  const menuId = useId();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);

  const selected = STATUS_OPTIONS.find((option) => option.value === value);

  function closeMenu() {
    setOpen(false);
  }

  function selectStatus(nextValue: TaskStatus) {
    onChange(nextValue);
    closeMenu();
  }

  return (
    <div className="relative flex min-w-0 items-center justify-end">
      <button
        ref={triggerRef}
        id={id}
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={menuId}
        onClick={() => setOpen((current) => !current)}
        className="flex h-7 min-w-8 shrink-0 items-center justify-center gap-1 rounded-md border border-hairline bg-canvas px-1 text-ink-muted-80 transition-colors hover:bg-muted outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
      >
        <StatusDot className={selected?.dotClass ?? ""} />
        <span className="min-w-0 truncate text-[13px] text-ink">
          {selected?.label}
        </span>
        <ChevronsUpDown
          className="size-3 shrink-0 text-ink-muted-80"
          aria-hidden="true"
          strokeWidth={1.75}
        />
      </button>

      <PortalMenu
        open={open}
        onClose={closeMenu}
        triggerRef={triggerRef}
        menuId={menuId}
        label="Task status options"
        arrowNav
        focusFirstOnOpen
        measureOptions={{ minWidth: 200, maxHeight: 320, minSpace: 120, belowThreshold: 160 }}
      >
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain py-1">
          {STATUS_OPTIONS.map((option) => {
            const isSelected = option.value === value;
            return (
              <button
                key={option.value}
                type="button"
                role="option"
                aria-selected={isSelected}
                onClick={() => selectStatus(option.value)}
                className={cn(
                  "flex min-h-9 w-full items-center gap-2.5 px-3 py-1.5 text-left text-[13px] text-ink transition-colors hover:bg-muted focus-visible:bg-muted focus-visible:outline-none",
                  isSelected && "bg-muted/70",
                )}
              >
                <StatusDot className={option.dotClass} />
                <span className="min-w-0 flex-1 truncate">
                  {option.label}
                </span>
                {isSelected ? (
                  <Check
                    className="size-3.5 shrink-0 text-primary"
                    aria-hidden="true"
                    strokeWidth={2.25}
                  />
                ) : null}
              </button>
            );
          })}
        </div>
      </PortalMenu>
    </div>
  );
}
