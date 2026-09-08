"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { Bell } from "lucide-react";

import { useNotifications } from "@/components/notifications/notifications-provider";

export function NotificationBell() {
  const router = useRouter();
  const { unread } = useNotifications();

  return (
    <Link
      href="/preferences/notifications"
      aria-label={
        unread > 0 ? `Notifications, ${unread} unread` : "Notifications"
      }
      onClick={() => router.refresh()}
      className="relative inline-flex size-11 items-center justify-center rounded-lg text-ink-muted-48 transition-[color,background-color,transform] hover:bg-muted hover:text-ink active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-focus"
    >
      <Bell className="size-4" />
      {unread > 0 ? (
        <span className="absolute -top-0.5 -right-0.5 flex h-4 min-w-4 items-center justify-center rounded-md bg-primary px-1 text-[10px] font-semibold text-primary-foreground">
          {unread > 99 ? "99+" : unread}
        </span>
      ) : null}
    </Link>
  );
}
