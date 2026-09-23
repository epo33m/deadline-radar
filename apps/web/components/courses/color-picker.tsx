"use client";

import { ChevronDown, ChevronsUpDown } from "lucide-react";
import { useId, useRef, useState } from "react";

import { FieldInfoButton } from "@/components/courses/field-info-button";
import { PortalMenu } from "@/components/ui/portal-menu";
import {
  COURSE_COLOR_GROUPS,
  findCourseColorOption,
  getCourseColorLabel,
  isLightCourseColor,
  NO_COURSE_COLOR,
  normalizeCourseColorForStorage,
  type CourseColorToken,
} from "@/lib/courses/colors";
import { cn } from "@/lib/utils";

type ColorPickerProps = {
  id?: string;
  value: string;
  onChange: (value: string) => void;
  info?: string;
  /** Render a small trailing-edge control (dot + chevron) instead of a full-width field. */
  compact?: boolean;
  className?: string;
  "aria-describedby"?: string;
};

function ColorDot({ color }: { color: string | null }) {
  const lightFill = color ? isLightCourseColor(color) : false;

  return (
    <span
      aria-hidden="true"
      className={cn(
        "size-3 shrink-0 rounded-full border",
        !color && "border-hairline bg-transparent",
        color && (lightFill ? "border-ink-muted-48" : "border-black/10"),
      )}
      style={color ? { backgroundColor: color } : undefined}
    />
  );
}

function ColorOption({
  option,
  selected,
  onSelect,
}: {
  option: CourseColorToken;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      role="option"
      aria-selected={selected}
      onClick={onSelect}
      className={cn(
        "flex min-h-11 w-full items-center gap-2.5 px-3 py-2 text-left text-[15px] text-ink transition-colors hover:bg-muted focus-visible:bg-muted focus-visible:outline-none",
        selected && "bg-muted/70",
      )}
    >
      <ColorDot color={option.light || null} />
      <span className="min-w-0 truncate">{option.label}</span>
    </button>
  );
}

export function ColorPicker({
  id,
  value,
  onChange,
  info,
  compact = false,
  className,
  "aria-describedby": ariaDescribedByExternal,
}: ColorPickerProps) {
  const menuId = useId();
  const helpId = useId();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);

  const selectedLabel = getCourseColorLabel(value);
  const displayValue = normalizeCourseColorForStorage(value);
  const ariaDescribedBy = [ariaDescribedByExternal, info ? helpId : null]
    .filter(Boolean)
    .join(" ");

  function closeMenu() {
    setOpen(false);
  }

  function toggleMenu() {
    setOpen((current) => !current);
  }

  function selectPreset(nextValue: string) {
    onChange(nextValue);
    closeMenu();
  }

  function isOptionSelected(option: CourseColorToken): boolean {
    if (option.token === "none") return value === "";
    return findCourseColorOption(value)?.token === option.token;
  }

  return (
    <div className={cn("relative min-w-0", compact && "flex items-center justify-end")}>
      {info ? (
        <span id={helpId} className="sr-only">
          {info}
        </span>
      ) : null}
      <button
        ref={triggerRef}
        id={id}
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={menuId}
        aria-describedby={ariaDescribedBy || undefined}
        onClick={toggleMenu}
        className={
          compact
            ? "flex h-8 min-w-10 shrink-0 items-center justify-center gap-1 rounded-md border border-hairline bg-canvas px-1.5 text-ink-muted-80 transition-colors hover:bg-muted outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
            : cn("flex w-full items-center justify-end gap-2", className)
        }
      >
        <ColorDot color={displayValue || null} />
        {!compact ? (
          <span
            className={cn(
              "min-w-0 truncate",
              !displayValue && "text-ink-muted-48",
            )}
          >
            {selectedLabel}
          </span>
        ) : null}
        {compact ? (
          <ChevronsUpDown
            className="size-3.5 shrink-0 text-ink-muted-80"
            aria-hidden="true"
            strokeWidth={1.75}
          />
        ) : (
          <ChevronDown
            className="size-4 shrink-0 text-ink-muted-48"
            aria-hidden="true"
            strokeWidth={1.75}
          />
        )}
      </button>
      {info ? (
        <div className="pointer-events-none absolute inset-y-0 right-0 z-10 flex items-center">
          <FieldInfoButton info={info} />
        </div>
      ) : null}

      <PortalMenu
        open={open}
        onClose={closeMenu}
        triggerRef={triggerRef}
        menuId={menuId}
        label="Course color options"
        arrowNav
        focusFirstOnOpen
        measureOptions={{ minWidth: 260, maxHeight: 360, minSpace: 120, belowThreshold: 160 }}
      >
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain py-1">
          <ColorOption
            option={NO_COURSE_COLOR}
            selected={isOptionSelected(NO_COURSE_COLOR)}
            onSelect={() => selectPreset(NO_COURSE_COLOR.light)}
          />

          {COURSE_COLOR_GROUPS.map((group) => (
            <div key={group.label} role="presentation">
              <div className="px-3 py-1.5 text-xs font-medium tracking-normal text-ink-muted-48">
                {group.label}
              </div>
              {group.options.map((option) => (
                <ColorOption
                  key={option.token}
                  option={option}
                  selected={isOptionSelected(option)}
                  onSelect={() => selectPreset(option.light)}
                />
              ))}
            </div>
          ))}
        </div>
      </PortalMenu>
    </div>
  );
}