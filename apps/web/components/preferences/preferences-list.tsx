"use client";

import { ChevronRight } from "lucide-react";
import { useState } from "react";

import { TimezoneForm } from "@/components/preferences/timezone-form";
import { Dialog } from "@/components/ui/dialog";

type PreferencesListProps = {
  timezone: string;
};

export function PreferencesList({ timezone }: PreferencesListProps) {
  const [open, setOpen] = useState(false);
  const [currentTimezone, setCurrentTimezone] = useState(timezone);
  const [summary, setSummary] = useState(timezone);
  const [trackedTimezone, setTrackedTimezone] = useState(timezone);

  // Sync from server prop without an effect (avoids cascading renders).
  if (trackedTimezone !== timezone) {
    setTrackedTimezone(timezone);
    setCurrentTimezone(timezone);
    setSummary(timezone);
  }

  return (
    <>
      <ul className="list-none overflow-hidden rounded-xl border border-hairline bg-canvas">
        <li>
          <button
            type="button"
            onClick={() => setOpen(true)}
            className="flex min-h-12 w-full items-center justify-between gap-4 px-3 py-3 text-left outline-none transition-colors hover:bg-muted/50 focus-visible:bg-muted/50 focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:ring-inset sm:px-4 sm:py-3.5"
          >
            <span className="shrink-0 text-[17px] font-medium leading-snug tracking-[-0.2px] text-ink">
              Time Zone
            </span>
            <span className="flex min-w-0 items-center gap-1 text-[15px] text-ink-muted-80 sm:text-[17px]">
              <span className="truncate">{summary}</span>
              <ChevronRight
                className="size-4 shrink-0 text-ink-muted-48"
                aria-hidden="true"
                strokeWidth={1.75}
              />
            </span>
          </button>
        </li>
      </ul>

      <Dialog open={open} onOpenChange={setOpen} title="Time Zone">
        <TimezoneForm
          initialTimezone={currentTimezone}
          onTimezoneChange={(nextTimezone) => {
            setCurrentTimezone(nextTimezone);
            setSummary(nextTimezone);
          }}
        />
      </Dialog>
    </>
  );
}
