"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

/** Keep duration-based summary counts fresh while the page sits idle. */
const SUMMARY_REFRESH_INTERVAL_MS = 60_000;

/**
 * Re-fetches the summary Server Components on a fixed interval and immediately
 * when the tab becomes visible again, so "Today / This week / Missed" counts
 * derived server-side do not go stale while the tab is idle. Renders nothing.
 */
export function SummaryRefresh({
  intervalMs = SUMMARY_REFRESH_INTERVAL_MS,
}: {
  intervalMs?: number;
}) {
  const router = useRouter();

  useEffect(() => {
    const refresh = () => router.refresh();
    const id = window.setInterval(() => {
      if (!document.hidden) {
        refresh();
      }
    }, intervalMs);

    function onVisibilityChange() {
      if (document.visibilityState === "visible") {
        refresh();
      }
    }
    document.addEventListener("visibilitychange", onVisibilityChange);

    return () => {
      window.clearInterval(id);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [router, intervalMs]);

  return null;
}