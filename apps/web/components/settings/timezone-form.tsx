"use client";

import {
  Check,
  ChevronsUpDown,
  CircleAlert,
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

import { updateTimezone } from "@/app/actions/auth";
import {
  DialogFormRow,
  dialogFormListClassName,
} from "@/components/ui/dialog-form";
import { PortalMenu } from "@/components/ui/portal-menu";
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
  onTimezoneChange?: (timezone: string) => void;
};

type SaveStatus = "idle" | "saving" | "saved" | "error";

const SAVED_FEEDBACK_MS = 2500;
const SAVE_ERROR_MESSAGE = "Couldn't save your time zone.\nPlease try again.";

export function TimezoneForm({
  initialTimezone,
  onTimezoneChange,
}: TimezoneFormProps) {
  const menuId = useId();
  const searchId = useId();
  const statusId = useId();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const savedTimerRef = useRef<number | null>(null);
  const onTimezoneChangeRef = useRef(onTimezoneChange);

  const catalog = useMemo(() => listTimeZones(), []);
  const [mode, setMode] = useState<TimezoneMode>(() => readStoredTimezoneMode());
  const [timezone, setTimezone] = useState(initialTimezone);
  const [trackedInitialTimezone, setTrackedInitialTimezone] =
    useState(initialTimezone);
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [status, setStatus] = useState<SaveStatus>("idle");
  const [isPending, startTransition] = useTransition();
  const modeRef = useRef(mode);
  const timezoneRef = useRef(timezone);
  const pendingRetryRef = useRef<{
    mode: TimezoneMode;
    zone: string;
  } | null>(null);

  // Sync from parent prop without an effect (avoids cascading renders).
  if (trackedInitialTimezone !== initialTimezone) {
    setTrackedInitialTimezone(initialTimezone);
    setTimezone(initialTimezone);
  }

  const isAutomatic = mode === "automatic";

  useEffect(() => {
    onTimezoneChangeRef.current = onTimezoneChange;
  }, [onTimezoneChange]);

  useEffect(() => {
    modeRef.current = mode;
  }, [mode]);

  useEffect(() => {
    timezoneRef.current = timezone;
  }, [timezone]);

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
        onTimezoneChangeRef.current?.(resolved);
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

  function toggleMenu() {
    if (isAutomatic) return;
    if (open) {
      closeMenu();
      return;
    }
    setOpen(true);
  }

  function setAutomaticEnabled(enabled: boolean) {
    if (enabled) {
      if (open) closeMenu();
      persistTimezone("automatic", detectBrowserTimeZone());
      return;
    }
    persistTimezone("manual", timezoneRef.current || detectBrowserTimeZone());
  }

  function selectZone(zone: string) {
    persistTimezone("manual", zone);
    closeMenu();
  }

  const showSaving = status === "saving" || isPending;
  const showSaved = status === "saved" && !showSaving;
  const showError = status === "error" && !showSaving;

  const menu =
    open && !isAutomatic ? (
      <PortalMenu
        open={open}
        onClose={closeMenu}
        triggerRef={triggerRef}
        menuId={menuId}
        label="Time zone options"
        arrowNav
        searchRef={searchRef}
        measureOptions={{ minWidth: 300, maxHeight: 380 }}
      >
        <div className="border-b border-hairline px-3 py-2.5">
          <label htmlFor={searchId} className="sr-only">
            Search time zones
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
              placeholder="Search time zones..."
              autoComplete="off"
              className="h-10 w-full rounded-lg border border-hairline bg-canvas pr-3 pl-9 text-[15px] text-ink outline-none placeholder:text-ink-muted-48 focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
            />
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain py-1">
          {filteredZones.map((zone) => {
            const selected = timezone === zone;
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
              No time zones match “{query.trim()}”.
            </p>
          ) : null}
        </div>
      </PortalMenu>
    ) : null;

  return (
    <div className="w-full space-y-3 text-left">
      <ul className={dialogFormListClassName}>
        <DialogFormRow label="Set Automatically">
          <div className="flex justify-end">
            <button
              type="button"
              role="switch"
              aria-checked={isAutomatic}
              aria-label="Set Automatically"
              disabled={showSaving}
              onClick={() => setAutomaticEnabled(!isAutomatic)}
              className={cn(
                "relative h-7 w-12 shrink-0 rounded-full transition-colors outline-none focus-visible:ring-3 focus-visible:ring-ring/50 disabled:opacity-50",
                isAutomatic ? "bg-primary" : "bg-hairline",
              )}
            >
              <span
                aria-hidden="true"
                className={cn(
                  "absolute top-0.5 left-0.5 size-6 rounded-full bg-canvas shadow-sm transition-transform",
                  isAutomatic && "translate-x-5",
                )}
              />
            </button>
          </div>
        </DialogFormRow>

        <DialogFormRow label="Time Zone" htmlFor="timezone-trigger">
          <div className="flex justify-end">
            <button
              ref={triggerRef}
              id="timezone-trigger"
              type="button"
              aria-haspopup="listbox"
              aria-expanded={open}
              aria-controls={menuId}
              aria-describedby={showError ? statusId : undefined}
              disabled={isAutomatic || showSaving}
              onClick={toggleMenu}
              className={cn(
                "flex min-w-0 items-center justify-end gap-1.5 rounded-lg text-[15px] outline-none focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-not-allowed",
                showError
                  ? "text-destructive"
                  : isAutomatic
                    ? "text-ink-muted-48"
                    : "text-ink-muted-80",
              )}
            >
              <span className="truncate">{timezone}</span>
              <ChevronsUpDown
                className="size-4 shrink-0 text-ink-muted-48"
                aria-hidden="true"
                strokeWidth={1.75}
              />
            </button>
          </div>
        </DialogFormRow>
      </ul>

      <div id={statusId} aria-live="polite" className="px-0">
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
