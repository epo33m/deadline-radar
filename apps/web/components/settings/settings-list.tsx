"use client";

import { CalendarClock, ChevronRight } from "lucide-react";
import { useState } from "react";
import type { TimeFormat } from "@deadline-radar/validation";

import { TimeFormatForm } from "@/components/settings/time-format-form";
import { TimezoneForm } from "@/components/settings/timezone-form";
import { Dialog } from "@/components/ui/dialog";
import {
  formCardClassName,
  formSectionGapClassName,
} from "@/components/ui/dialog-form";
import { cn } from "@/lib/utils";

type SettingsListProps = {
  timezone: string;
  timeFormat: TimeFormat;
};

export function SettingsList({ timezone, timeFormat }: SettingsListProps) {
  const [open, setOpen] = useState(false);
  const [currentTimezone, setCurrentTimezone] = useState(timezone);
  const [trackedTimezone, setTrackedTimezone] = useState(timezone);
  const [currentTimeFormat, setCurrentTimeFormat] =
    useState<TimeFormat>(timeFormat);
  const [trackedTimeFormat, setTrackedTimeFormat] =
    useState<TimeFormat>(timeFormat);

  // Sync from server prop without an effect (avoids cascading renders).
  if (trackedTimezone !== timezone) {
    setTrackedTimezone(timezone);
    setCurrentTimezone(timezone);
  }
  if (trackedTimeFormat !== timeFormat) {
    setTrackedTimeFormat(timeFormat);
    setCurrentTimeFormat(timeFormat);
  }

  return (
    <>
      <ul className={cn("list-none", formCardClassName)}>
        <li>
          <button
            type="button"
            onClick={() => setOpen(true)}
            className="flex min-h-12 w-full items-center justify-between gap-4 py-3 text-left outline-none transition-colors hover:bg-muted/50 focus-visible:bg-muted/50 focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:ring-inset sm:py-3.5"
          >
            <span className="flex min-w-0 items-center gap-2.5">
              <CalendarClock
                className="size-4 shrink-0 text-ink-muted-48"
                aria-hidden="true"
                strokeWidth={1.75}
              />
              <span className="shrink-0 text-[17px] font-medium leading-snug tracking-[-0.2px] text-ink">
                Date & Time
              </span>
            </span>
            <ChevronRight
              className="size-4 shrink-0 text-ink-muted-48"
              aria-hidden="true"
              strokeWidth={1.75}
            />
          </button>
        </li>
      </ul>

      <Dialog open={open} onOpenChange={setOpen} title="Date & Time">
        <div className={cn("w-full text-left", formSectionGapClassName)}>
          <TimeFormatForm
            initialTimeFormat={currentTimeFormat}
            onTimeFormatChange={(nextFormat) => {
              setCurrentTimeFormat(nextFormat);
            }}
          />
          <TimezoneForm
            initialTimezone={currentTimezone}
            onTimezoneChange={(nextTimezone) => {
              setCurrentTimezone(nextTimezone);
            }}
          />
        </div>
      </Dialog>
    </>
  );
}
