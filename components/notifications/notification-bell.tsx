"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Bell } from "lucide-react";

import { countUnreadInAppNotifications } from "@/app/actions/notifications";

const POLL_INTERVAL_MS = 60_000;

export function NotificationBell() {
  const router = useRouter();
  const [unread, setUnread] = useState(0);

  useEffect(() => {
    let cancelled = false;

    async function refresh() {
      try {
        const count = await countUnreadInAppNotifications();
        if (!cancelled) setUnread(count);
      } catch {
        // Ignore transient poll errors.
      }
    }

    void refresh();
    const id = window.setInterval(() => {
      void refresh();
    }, POLL_INTERVAL_MS);

    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, []);

  return (
    <Link
      href="/notifications"
      aria-label={
        unread > 0 ? `Notifications, ${unread} unread` : "Notifications"
      }
      onClick={() => router.refresh()}
      className="relative inline-flex size-8 items-center justify-center rounded-lg text-ink-muted-48 hover:bg-muted hover:text-ink"
    >
      <Bell className="size-4" />
      {unread > 0 ? (
        <span className="absolute -top-0.5 -right-0.5 flex h-4 min-w-4 items-center justify-center rounded-md bg-primary px-1 text-[10px] font-medium text-primary-foreground">
          {unread > 99 ? "99+" : unread}
        </span>
      ) : null}
    </Link>
  );
}
