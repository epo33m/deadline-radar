"use client";

import { Check, CircleAlert, LoaderCircle } from "lucide-react";
import { useCallback, useEffect, useId, useRef, useState, useTransition } from "react";
import type { TimeFormat } from "@deadline-radar/validation";

import { updateTimeFormat } from "@/app/actions/auth";
import {
  DialogFormRow,
  dialogFormListClassName,
  formSectionGapClassName,
} from "@/components/ui/dialog-form";
import { cn } from "@/lib/utils";

type TimeFormatFormProps = {
  initialTimeFormat: TimeFormat;
  onTimeFormatChange?: (timeFormat: TimeFormat) => void;
};

type SaveStatus = "idle" | "saving" | "saved" | "error";

const SAVED_FEEDBACK_MS = 2500;
const SAVE_ERROR_MESSAGE =
  "Couldn't save your time format.\nPlease try again.";

export function TimeFormatForm({
  initialTimeFormat,
  onTimeFormatChange,
}: TimeFormatFormProps) {
  const statusId = useId();
  const savedTimerRef = useRef<number | null>(null);
  const onTimeFormatChangeRef = useRef(onTimeFormatChange);

  const [timeFormat, setTimeFormat] = useState<TimeFormat>(initialTimeFormat);
  const [trackedInitial, setTrackedInitial] =
    useState<TimeFormat>(initialTimeFormat);
  const [status, setStatus] = useState<SaveStatus>("idle");
  const [isPending, startTransition] = useTransition();
  const timeFormatRef = useRef(timeFormat);
  const pendingRetryRef = useRef<TimeFormat | null>(null);

  // Sync from parent prop without an effect (avoids cascading renders).
  if (trackedInitial !== initialTimeFormat) {
    setTrackedInitial(initialTimeFormat);
    setTimeFormat(initialTimeFormat);
  }

  useEffect(() => {
    onTimeFormatChangeRef.current = onTimeFormatChange;
  }, [onTimeFormatChange]);

  useEffect(() => {
    timeFormatRef.current = timeFormat;
  }, [timeFormat]);

  useEffect(() => {
    return () => {
      if (savedTimerRef.current !== null) {
        window.clearTimeout(savedTimerRef.current);
      }
    };
  }, []);

  const persistTimeFormat = useCallback((next: TimeFormat) => {
    if (next === timeFormatRef.current && pendingRetryRef.current === null) {
      return;
    }
    const previous = timeFormatRef.current;
    pendingRetryRef.current = next;
    setTimeFormat(next);
    setStatus("saving");

    if (savedTimerRef.current !== null) {
      window.clearTimeout(savedTimerRef.current);
      savedTimerRef.current = null;
    }

    startTransition(async () => {
      const formData = new FormData();
      formData.set("timeFormat", next);
      const result = await updateTimeFormat({}, formData);

      if (result.error) {
        setTimeFormat(previous);
        setStatus("error");
        return;
      }

      pendingRetryRef.current = null;
      setStatus("saved");
      onTimeFormatChangeRef.current?.(next);
      savedTimerRef.current = window.setTimeout(() => {
        setStatus("idle");
        savedTimerRef.current = null;
      }, SAVED_FEEDBACK_MS);
    });
  }, []);

  function retrySave() {
    const pending = pendingRetryRef.current;
    if (!pending) return;
    pendingRetryRef.current = null;
    persistTimeFormat(pending);
  }

  const showSaving = status === "saving" || isPending;
  const showSaved = status === "saved" && !showSaving;
  const showError = status === "error" && !showSaving;

  const is24Hour = timeFormat === "24h";

  return (
    <div className={cn("w-full text-left", formSectionGapClassName)}>
      <ul className={dialogFormListClassName}>
        <DialogFormRow label="24-hour format">
          <div className="flex justify-end">
            <button
              type="button"
              role="switch"
              aria-checked={is24Hour}
              aria-label="24-hour format"
              disabled={showSaving}
              onClick={() => persistTimeFormat(is24Hour ? "12h" : "24h")}
              className={cn(
                "relative h-7 w-12 shrink-0 rounded-full transition-colors outline-none focus-visible:ring-3 focus-visible:ring-ring/50 disabled:opacity-50",
                is24Hour ? "bg-primary" : "bg-hairline",
              )}
            >
              <span
                aria-hidden="true"
                className={cn(
                  "absolute top-0.5 left-0.5 size-6 rounded-full bg-canvas shadow-sm transition-transform",
                  is24Hour && "translate-x-5",
                )}
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
    </div>
  );
}
