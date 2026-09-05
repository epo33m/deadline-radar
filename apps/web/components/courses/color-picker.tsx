"use client";

import { ChevronDown } from "lucide-react";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";

import { FieldInfoButton } from "@/components/courses/field-info-button";
import { getFocusableElements } from "@/components/ui/dialog";
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
  className?: string;
  "aria-describedby"?: string;
};

type MenuPosition = {
  variant: "dropdown" | "sheet";
  top?: number;
  bottom?: number;
  left: number;
  width: number;
  maxHeight: number;
};

const MENU_MIN_WIDTH = 260;
const MENU_MARGIN = 16;
const MENU_MAX_HEIGHT = 360;
const MOBILE_SHEET_BREAKPOINT = 640;

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

function measureMenuPosition(trigger: HTMLButtonElement): MenuPosition {
  const viewportWidth = window.innerWidth;
  const viewportHeight = window.innerHeight;

  if (viewportWidth < MOBILE_SHEET_BREAKPOINT) {
    return {
      variant: "sheet",
      bottom: MENU_MARGIN,
      left: MENU_MARGIN,
      width: viewportWidth - MENU_MARGIN * 2,
      maxHeight: Math.min(MENU_MAX_HEIGHT, viewportHeight - MENU_MARGIN * 2),
    };
  }

  const rect = trigger.getBoundingClientRect();
  const width = Math.min(
    Math.max(rect.width, MENU_MIN_WIDTH),
    viewportWidth - MENU_MARGIN * 2,
  );
  const left = Math.min(
    Math.max(MENU_MARGIN, rect.left),
    viewportWidth - width - MENU_MARGIN,
  );
  const gap = 6;
  const spaceBelow = viewportHeight - rect.bottom - gap - MENU_MARGIN;
  const spaceAbove = rect.top - gap - MENU_MARGIN;
  const maxHeight = Math.min(
    MENU_MAX_HEIGHT,
    Math.max(Math.min(spaceBelow, spaceAbove), 120),
  );

  if (spaceBelow >= 160 || spaceBelow >= spaceAbove) {
    return {
      variant: "dropdown",
      top: rect.bottom + gap,
      left,
      width,
      maxHeight,
    };
  }

  return {
    variant: "dropdown",
    top: Math.max(MENU_MARGIN, rect.top - gap - maxHeight),
    left,
    width,
    maxHeight,
  };
}

export function ColorPicker({
  id,
  value,
  onChange,
  info,
  className,
  "aria-describedby": ariaDescribedByExternal,
}: ColorPickerProps) {
  const menuId = useId();
  const helpId = useId();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [menuPosition, setMenuPosition] = useState<MenuPosition | null>(null);

  const selectedLabel = getCourseColorLabel(value);
  const displayValue = normalizeCourseColorForStorage(value);
  const ariaDescribedBy = [ariaDescribedByExternal, info ? helpId : null]
    .filter(Boolean)
    .join(" ");

  const closeMenu = useCallback(() => {
    setOpen(false);
    window.requestAnimationFrame(() => {
      triggerRef.current?.focus();
    });
  }, []);

  useEffect(() => {
    if (!open || !triggerRef.current) return;

    function updatePosition() {
      if (!triggerRef.current) return;
      setMenuPosition(measureMenuPosition(triggerRef.current));
    }

    updatePosition();
    window.addEventListener("resize", updatePosition);
    window.addEventListener("scroll", updatePosition, true);

    return () => {
      window.removeEventListener("resize", updatePosition);
      window.removeEventListener("scroll", updatePosition, true);
    };
  }, [open]);

  useEffect(() => {
    if (!open || !menuRef.current) return;

    const frame = window.requestAnimationFrame(() => {
      const first = getFocusableElements(menuRef.current!)[0];
      first?.focus();
    });

    function handlePointerDown(event: MouseEvent) {
      const target = event.target as Node;
      if (
        menuRef.current?.contains(target) ||
        triggerRef.current?.contains(target)
      ) {
        return;
      }
      closeMenu();
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        closeMenu();
        return;
      }

      if (!menuRef.current) return;
      const items = getFocusableElements(menuRef.current);
      if (items.length === 0) return;

      const currentIndex = items.findIndex(
        (item) => item === document.activeElement,
      );

      if (event.key === "ArrowDown") {
        event.preventDefault();
        items[(currentIndex + 1 + items.length) % items.length]?.focus();
      } else if (event.key === "ArrowUp") {
        event.preventDefault();
        items[(currentIndex - 1 + items.length) % items.length]?.focus();
      } else if (event.key === "Home") {
        event.preventDefault();
        items[0]?.focus();
      } else if (event.key === "End") {
        event.preventDefault();
        items[items.length - 1]?.focus();
      } else if (event.key === "Tab") {
        event.preventDefault();
        if (event.shiftKey) {
          items[(currentIndex - 1 + items.length) % items.length]?.focus();
        } else {
          items[(currentIndex + 1) % items.length]?.focus();
        }
      }
    }

    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown, true);

    return () => {
      window.cancelAnimationFrame(frame);
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown, true);
    };
  }, [open, closeMenu]);

  function toggleMenu() {
    if (open) {
      closeMenu();
      return;
    }
    setOpen(true);
  }

  function selectPreset(nextValue: string) {
    onChange(nextValue);
    closeMenu();
  }

  function isOptionSelected(option: CourseColorToken): boolean {
    if (option.token === "none") return value === "";
    return findCourseColorOption(value)?.token === option.token;
  }

  const menu =
    open && menuPosition
      ? createPortal(
          <div
            ref={menuRef}
            id={menuId}
            data-color-picker-menu=""
            role="listbox"
            aria-label="Course color options"
            style={{
              ...(menuPosition.variant === "sheet"
                ? {
                    bottom: `max(${menuPosition.bottom ?? MENU_MARGIN}px, env(safe-area-inset-bottom, 0px))`,
                    left: menuPosition.left,
                    width: menuPosition.width,
                    maxHeight: menuPosition.maxHeight,
                  }
                : {
                    top: menuPosition.top,
                    left: menuPosition.left,
                    width: menuPosition.width,
                    maxHeight: menuPosition.maxHeight,
                  }),
            }}
            className={cn(
              "fixed z-[60] overflow-y-auto overscroll-contain border border-hairline bg-canvas py-1 shadow-sm",
              menuPosition.variant === "sheet" ? "rounded-2xl" : "rounded-xl",
            )}
          >
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
          </div>,
          document.body,
        )
      : null;

  return (
    <div className="relative min-w-0">
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
        className={cn(
          "relative flex w-full items-center gap-2.5 text-left",
          className,
        )}
      >
        <span className="pointer-events-none absolute inset-y-0 left-4 flex items-center">
          <ColorDot color={displayValue || null} />
        </span>
        <span
          className={cn(
            "min-w-0 flex-1 truncate pl-8",
            info ? "pr-14" : "pr-10",
            !displayValue && "text-ink-muted-48",
          )}
        >
          {selectedLabel}
        </span>
        <span
          className={cn(
            "pointer-events-none absolute inset-y-0 flex items-center",
            info ? "right-10" : "right-3.5",
          )}
        >
          <ChevronDown
            className="size-4 text-ink-muted-48"
            aria-hidden="true"
            strokeWidth={1.75}
          />
        </span>
      </button>
      {info ? (
        <div className="absolute inset-y-0 right-2.5 z-10 flex items-center">
          <FieldInfoButton info={info} />
        </div>
      ) : null}
      {menu}
    </div>
  );
}
