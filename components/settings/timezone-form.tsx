"use client";

import {
  Check,
  ChevronDown,
  CircleAlert,
  Globe2,
  Info,
  LoaderCircle,
  Search,
} from "lucide-react";
import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  useTransition,
} from "react";
import { createPortal } from "react-dom";

import { updateTimezone } from "@/app/actions/auth";
import { getFocusableElements } from "@/components/ui/dialog";
import {
  detectBrowserTimeZone,
  formatUtcOffset,
  listTimeZones,
  readStoredTimezoneMode,
  resolveTimezoneForSave,
  searchTimeZones,
  type TimezoneMode,
  writeStoredTimezoneMode,
} from "@/lib/timezone";
import { cn } from "@/lib/utils";

type TimezoneFormProps = {
  initialTimezone: string;
};

type MenuPosition = {
  variant: "dropdown" | "sheet";
  top?: number;
  bottom?: number;
  left: number;
  width: number;
  maxHeight: number;
};

type SaveStatus = "idle" | "saving" | "saved" | "error";

const MENU_MIN_WIDTH = 300;
const MENU_MARGIN = 16;
const MENU_MAX_HEIGHT = 380;
const MOBILE_SHEET_BREAKPOINT = 640;
const SAVED_FEEDBACK_MS = 2500;
const SAVE_ERROR_MESSAGE = "Couldn't save your timezone.\nPlease try again.";

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
    Math.max(Math.min(spaceBelow, spaceAbove), 160),
  );

  if (spaceBelow >= 200 || spaceBelow >= spaceAbove) {
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

export function TimezoneForm({ initialTimezone }: TimezoneFormProps) {
  const menuId = useId();
  const searchId = useId();
  const statusId = useId();
  const descriptionId = useId();
  const autoInfoId = useId();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const savedTimerRef = useRef<number | null>(null);

  const catalog = useMemo(() => listTimeZones(), []);
  const [mode, setMode] = useState<TimezoneMode>("manual");
  const [timezone, setTimezone] = useState(initialTimezone);
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [menuPosition, setMenuPosition] = useState<MenuPosition | null>(null);
  const [status, setStatus] = useState<SaveStatus>("idle");
  const [isPending, startTransition] = useTransition();
  const modeRef = useRef(mode);
  const timezoneRef = useRef(timezone);
  const pendingRetryRef = useRef<{
    mode: TimezoneMode;
    zone: string;
  } | null>(null);

  useEffect(() => {
    modeRef.current = mode;
  }, [mode]);

  useEffect(() => {
    timezoneRef.current = timezone;
  }, [timezone]);

  useEffect(() => {
    setMode(readStoredTimezoneMode());
  }, []);

  useEffect(() => {
    return () => {
      if (savedTimerRef.current !== null) {
        window.clearTimeout(savedTimerRef.current);
      }
    };
  }, []);

  const filteredZones = useMemo(
    () => searchTimeZones(query, catalog),
    [catalog, query],
  );

  const triggerLabel = mode === "automatic" ? "Automatic" : timezone;
  const helpingCopy =
    mode === "automatic"
      ? "Uses your browser timezone to schedule reminders."
      : "Used to schedule reminders at your local time.";

  const closeMenu = useCallback(() => {
    setOpen(false);
    setQuery("");
    window.requestAnimationFrame(() => {
      triggerRef.current?.focus();
    });
  }, []);

  const persistTimezone = useCallback(
    (nextMode: TimezoneMode, nextZone: string) => {
      const previousMode = modeRef.current;
      const previousTimezone = timezoneRef.current;
      const browserZone = detectBrowserTimeZone();
      const resolved = resolveTimezoneForSave({
        mode: nextMode,
        selectedZone: nextZone,
        browserZone,
      });

      pendingRetryRef.current = { mode: nextMode, zone: nextZone };
      setMode(nextMode);
      setTimezone(resolved);
      writeStoredTimezoneMode(nextMode);
      setStatus("saving");

      if (savedTimerRef.current !== null) {
        window.clearTimeout(savedTimerRef.current);
        savedTimerRef.current = null;
      }

      startTransition(async () => {
        const formData = new FormData();
        formData.set("timezone", resolved);
        const result = await updateTimezone({}, formData);

        if (result.error) {
          setMode(previousMode);
          setTimezone(previousTimezone);
          writeStoredTimezoneMode(previousMode);
          setStatus("error");
          return;
        }

        pendingRetryRef.current = null;
        setStatus("saved");
        savedTimerRef.current = window.setTimeout(() => {
          setStatus("idle");
          savedTimerRef.current = null;
        }, SAVED_FEEDBACK_MS);
      });
    },
    [],
  );

  function retrySave() {
    const pending = pendingRetryRef.current;
    if (!pending) return;
    if (pending.mode === "automatic") {
      persistTimezone("automatic", detectBrowserTimeZone());
      return;
    }
    persistTimezone("manual", pending.zone);
  }

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
      searchRef.current?.focus();
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
      if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
      if (document.activeElement === searchRef.current) return;

      const items = getFocusableElements(menuRef.current).filter(
        (el) => el !== searchRef.current,
      );
      if (items.length === 0) return;

      const currentIndex = items.findIndex(
        (item) => item === document.activeElement,
      );

      event.preventDefault();
      if (event.key === "ArrowDown") {
        items[(currentIndex + 1 + items.length) % items.length]?.focus();
      } else {
        items[(currentIndex - 1 + items.length) % items.length]?.focus();
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

  function selectAutomatic() {
    persistTimezone("automatic", detectBrowserTimeZone());
    closeMenu();
  }

  function selectZone(zone: string) {
    persistTimezone("manual", zone);
    closeMenu();
  }

  const showSaving = status === "saving" || isPending;
  const showSaved = status === "saved" && !showSaving;
  const showError = status === "error" && !showSaving;

  const menu =
    open && menuPosition
      ? createPortal(
          <div
            ref={menuRef}
            id={menuId}
            role="listbox"
            aria-label="Timezone options"
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
              "fixed z-[60] flex flex-col overflow-hidden border border-hairline bg-canvas shadow-sm",
              menuPosition.variant === "sheet" ? "rounded-2xl" : "rounded-xl",
            )}
          >
            <div className="border-b border-hairline px-3 py-2.5">
              <label htmlFor={searchId} className="sr-only">
                Search timezone
              </label>
              <div className="relative">
                <Search
                  className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-ink-muted-48"
                  aria-hidden="true"
                  strokeWidth={1.75}
                />
                <input
                  ref={searchRef}
                  id={searchId}
                  type="search"
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="Search timezone..."
                  autoComplete="off"
                  className="h-10 w-full rounded-lg border border-hairline bg-canvas pr-3 pl-9 text-[15px] text-ink outline-none placeholder:text-ink-muted-48 focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
                />
              </div>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain py-1">
              <button
                type="button"
                role="option"
                aria-selected={mode === "automatic"}
                onClick={selectAutomatic}
                className={cn(
                  "flex min-h-11 w-full items-start gap-3 px-3 py-2.5 text-left transition-colors hover:bg-muted focus-visible:bg-muted focus-visible:outline-none",
                  mode === "automatic" && "bg-muted/70",
                )}
              >
                <span className="min-w-0 flex-1">
                  <span className="block text-[15px] font-medium text-ink">
                    Automatic
                  </span>
                  <span className="mt-0.5 block text-[13px] text-ink-muted-48">
                    Use browser timezone
                  </span>
                </span>
                {mode === "automatic" ? (
                  <Check
                    className="mt-0.5 size-4 shrink-0 text-primary"
                    aria-hidden="true"
                    strokeWidth={2.25}
                  />
                ) : null}
              </button>

              {filteredZones.map((zone) => {
                const selected = mode === "manual" && timezone === zone;
                return (
                  <button
                    key={zone}
                    type="button"
                    role="option"
                    aria-selected={selected}
                    onClick={() => selectZone(zone)}
                    className={cn(
                      "flex min-h-11 w-full items-start gap-3 px-3 py-2.5 text-left transition-colors hover:bg-muted focus-visible:bg-muted focus-visible:outline-none",
                      selected && "bg-muted/70",
                    )}
                  >
                    <span className="min-w-0 flex-1">
                      <span className="block text-[15px] font-medium text-ink">
                        {zone}
                      </span>
                      <span className="mt-0.5 block text-[13px] text-ink-muted-48">
                        {formatUtcOffset(zone)}
                      </span>
                    </span>
                    {selected ? (
                      <Check
                        className="mt-0.5 size-4 shrink-0 text-primary"
                        aria-hidden="true"
                        strokeWidth={2.25}
                      />
                    ) : null}
                  </button>
                );
              })}

              {filteredZones.length === 0 ? (
                <p className="px-3 py-4 text-[14px] text-ink-muted-48">
                  No timezones match “{query.trim()}”.
                </p>
              ) : null}
            </div>
          </div>,
          document.body,
        )
      : null;

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-[minmax(0,1fr)_minmax(12rem,20rem)] sm:items-start sm:gap-x-6 sm:gap-y-1">
        <label
          htmlFor="timezone-trigger"
          className="text-[15px] font-medium tracking-[-0.2px] text-ink sm:pt-1"
        >
          Timezone
        </label>

        <button
          ref={triggerRef}
          id="timezone-trigger"
          type="button"
          aria-haspopup="listbox"
          aria-expanded={open}
          aria-controls={menuId}
          aria-describedby={`${descriptionId}${mode === "automatic" ? ` ${autoInfoId}` : ""}${status !== "idle" ? ` ${statusId}` : ""}`}
          aria-invalid={showError || undefined}
          onClick={toggleMenu}
          className={cn(
            "relative flex h-11 w-full items-center gap-2.5 rounded-xl border bg-canvas px-3 text-left text-[15px] text-ink transition-colors outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 sm:row-span-2 sm:self-start",
            showError
              ? "border-destructive focus-visible:border-destructive focus-visible:ring-destructive/20"
              : "border-hairline hover:bg-muted/40",
          )}
        >
          <Globe2
            className="size-4 shrink-0 text-ink-muted-48"
            aria-hidden="true"
            strokeWidth={1.75}
          />
          <span className="min-w-0 flex-1 truncate">{triggerLabel}</span>
          <ChevronDown
            className="size-4 shrink-0 text-ink-muted-48"
            aria-hidden="true"
            strokeWidth={1.75}
          />
        </button>

        <p
          id={descriptionId}
          className="text-[13px] leading-relaxed text-ink-muted-48 sm:order-none"
        >
          {helpingCopy}
        </p>
      </div>

      {mode === "automatic" ? (
        <div
          id={autoInfoId}
          className="flex gap-2.5 rounded-xl border border-primary/15 bg-primary/5 px-3 py-2.5 text-[13px] leading-relaxed text-ink-muted-80"
        >
          <Info
            className="mt-0.5 size-4 shrink-0 text-primary"
            aria-hidden="true"
            strokeWidth={1.75}
          />
          <p>
            Deadline Radar will use your browser&apos;s timezone to schedule
            reminders.
          </p>
        </div>
      ) : null}

      <div id={statusId} aria-live="polite">
        {showSaving ? (
          <p className="flex items-center gap-2 text-[13px] text-primary">
            <LoaderCircle
              className="size-3.5 animate-spin"
              aria-hidden="true"
              strokeWidth={2}
            />
            Saving changes...
          </p>
        ) : null}
        {showSaved ? (
          <p
            className="flex items-center gap-2 text-[13px] text-success"
            role="status"
          >
            <Check className="size-3.5" aria-hidden="true" strokeWidth={2.25} />
            Changes saved
          </p>
        ) : null}
        {showError ? (
          <div className="space-y-2" role="alert">
            <p className="flex items-start gap-2 text-[13px] whitespace-pre-line text-destructive">
              <CircleAlert
                className="mt-0.5 size-3.5 shrink-0"
                aria-hidden="true"
                strokeWidth={2}
              />
              <span>{SAVE_ERROR_MESSAGE}</span>
            </p>
            <button
              type="button"
              onClick={retrySave}
              className="text-[13px] font-medium text-primary underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
            >
              Try again
            </button>
          </div>
        ) : null}
      </div>

      {menu}
    </div>
  );
}
