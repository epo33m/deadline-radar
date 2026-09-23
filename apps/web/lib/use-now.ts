"use client";

import { useEffect, useState } from "react";

/** How often time-sensitive UI (overdue tones, relative deadlines, today) re-evaluates. */
export const NOW_REFRESH_INTERVAL_MS = 60_000;

function parseInitial(initialIso: string | undefined): Date {
  if (initialIso === undefined) return new Date();
  const date = new Date(initialIso);
  return Number.isNaN(date.getTime()) ? new Date() : date;
}

/**
 * Returns the current time as state so time-derived UI re-renders as it ticks.
 *
 * `initialIso` should be the server's "as of" timestamp (from the RSC page).
 * Seeding state with it keeps SSR and the first hydration render identical and
 * avoids hydration mismatches for time-derived values.
 *
 * Updates on a fixed interval and immediately when the tab becomes visible again
 * after being hidden (so long-idle tabs catch up as soon as the user looks back).
 */
export function useNow(
  intervalMs: number = NOW_REFRESH_INTERVAL_MS,
  initialIso?: string,
): Date {
  const [now, setNow] = useState(() => parseInitial(initialIso));

  useEffect(() => {
    const update = () => setNow(new Date());
    const id = window.setInterval(update, intervalMs);

    function onVisibilityChange() {
      if (document.visibilityState === "visible") {
        update();
      }
    }
    document.addEventListener("visibilitychange", onVisibilityChange);

    return () => {
      window.clearInterval(id);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [intervalMs]);

  return now;
}