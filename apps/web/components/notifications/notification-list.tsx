"use client";

import Link from "next/link";
import { Bell, CheckCheck, ChevronRight } from "lucide-react";
import { useEffect, useActionState, useMemo } from "react";
import type { TimeFormat } from "@deadline-radar/validation";

import {
  markAllNotificationsRead,
  markNotificationRead,
  type NotificationActionState,
} from "@/app/actions/notifications";
import { Button } from "@/components/ui/button";
import { useNotifications } from "@/components/notifications/notifications-provider";
import { formatDeadline } from "@/lib/datetime";
import { urgencyLabel } from "@/lib/reminders/urgency";
import { cn } from "@/lib/utils";
import type { InAppNotification } from "@/types/notification";

const initialState: NotificationActionState = {};

function MarkReadButton({ id }: { id: string }) {
  const { noteOneRead } = useNotifications();
  const [, action, pending] = useActionState(
    async (prev: NotificationActionState, formData: FormData) => {
      const result = await markNotificationRead(prev, formData);
      if (!result.error) noteOneRead();
      return result;
    },
    initialState,
  );

  return (
    <form action={action}>
      <input type="hidden" name="id" value={id} />
      <Button
        type="submit"
        variant="outline"
        size="sm"
        disabled={pending}
        className="h-8.5 px-3 text-xs sm:text-[13px] font-medium text-ink hover:bg-muted/80 rounded-lg shadow-2xs"
      >
        {pending ? "Saving…" : "Mark read"}
      </Button>
    </form>
  );
}

function MarkAllReadButton() {
  const { noteAllRead } = useNotifications();
  const [, action, pending] = useActionState(
    async (prev: NotificationActionState, formData: FormData) => {
      const result = await markAllNotificationsRead(prev, formData);
      if (!result.error) noteAllRead();
      return result;
    },
    initialState,
  );

  return (
    <form action={action}>
      <Button
        type="submit"
        variant="outline"
        size="sm"
        disabled={pending}
        className="h-9 gap-2 px-3.5 text-xs sm:text-sm font-medium rounded-lg shadow-2xs"
      >
        <CheckCheck className="size-4" aria-hidden="true" />
        {pending ? "Saving…" : "Mark all as read"}
      </Button>
    </form>
  );
}

export function NotificationList({
  notifications,
  listComplete = false,
  timeZone = "UTC",
  timeFormat = "24h",
}: {
  notifications: InAppNotification[];
  listComplete?: boolean;
  timeZone?: string;
  timeFormat?: TimeFormat;
}) {
  const { syncFromList } = useNotifications();
  const unreadCount = useMemo(
    () => notifications.filter((n) => !n.read_at).length,
    [notifications],
  );

  // The server already fetched this list; when it is complete the badge can
  // be aligned to ground truth at zero extra queries.
  useEffect(() => {
    if (listComplete) syncFromList(unreadCount);
  }, [listComplete, unreadCount, syncFromList]);

  if (notifications.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center rounded-2xl border border-divider-soft bg-surface-pearl px-6 py-20 text-center shadow-xs">
        <div className="mb-4 flex size-14 items-center justify-center rounded-2xl bg-primary/10 text-primary">
          <Bell className="size-7" strokeWidth={1.75} aria-hidden="true" />
        </div>
        <h3 className="font-display text-xl font-semibold tracking-[-0.2px] text-ink sm:text-[22px]">
          No notifications
        </h3>
        <p className="mt-2 max-w-md text-[15px] leading-relaxed text-ink-muted-64">
          You&apos;re all caught up. Reminders for upcoming deadlines will appear here.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between px-1">
        <div className="flex items-center gap-2.5">
          <h2 className="font-display text-[17px] font-semibold tracking-[-0.2px] text-ink sm:text-[19px]">
            All Reminders
          </h2>
          {unreadCount > 0 ? (
            <span className="flex h-5.5 min-w-5.5 items-center justify-center rounded-full bg-primary px-2 text-xs font-semibold text-primary-foreground">
              {unreadCount} unread
            </span>
          ) : null}
        </div>
        {unreadCount > 0 ? <MarkAllReadButton /> : null}
      </div>

      <ul className="divide-y divide-divider-soft rounded-2xl border border-divider-soft bg-surface-pearl shadow-xs overflow-hidden">
        {notifications.map((notification) => {
          const label =
            notification.days_before == null
              ? "Reminder"
              : urgencyLabel(notification.days_before);
          const unread = !notification.read_at;

          return (
            <li
              key={notification.id}
              className={cn(
                "group flex items-center justify-between gap-4 px-5 py-4 sm:px-6 sm:py-5 transition-colors",
                unread ? "bg-primary/[0.035]" : "hover:bg-muted/30",
              )}
            >
              <div className="flex min-w-0 items-start gap-3.5 sm:gap-4">
                <div className="mt-1.5 flex size-2.5 shrink-0 items-center justify-center">
                  {unread ? (
                    <span className="size-2.5 rounded-full bg-primary shadow-xs" aria-label="Unread" />
                  ) : (
                    <span className="size-2.5 rounded-full bg-transparent" />
                  )}
                </div>

                <div className="min-w-0 space-y-1.5">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="rounded-md bg-muted px-2.5 py-1 text-xs sm:text-[13px] font-medium text-ink-muted-80">
                      {label}
                    </span>
                    {notification.is_late ? (
                      <span className="rounded-md bg-destructive/10 px-2.5 py-1 text-xs sm:text-[13px] font-semibold text-destructive">
                        Late
                      </span>
                    ) : null}
                    <Link
                      href={`/tasks/${notification.task_id}`}
                      className="truncate text-[16px] sm:text-[17px] font-medium leading-snug tracking-[-0.2px] text-ink transition-colors hover:text-primary focus-visible:underline focus-visible:outline-none"
                    >
                      {notification.task_title ?? "Task"}
                    </Link>
                  </div>

                  <p className="text-[13px] sm:text-sm text-ink-muted-64">
                    {notification.sent_at
                      ? formatDeadline(notification.sent_at, timeZone, timeFormat)
                      : "—"}
                    {unread ? " · Unread" : " · Read"}
                  </p>
                </div>
              </div>

              <div className="flex shrink-0 items-center gap-3">
                {unread ? <MarkReadButton id={notification.id} /> : null}
                <Link
                  href={`/tasks/${notification.task_id}`}
                  aria-label={`Open task ${notification.task_title ?? ""}`}
                  className="rounded-lg p-2 text-ink-muted-48 transition-colors hover:bg-muted hover:text-ink focus-visible:bg-muted focus-visible:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-focus"
                >
                  <ChevronRight className="size-5" aria-hidden="true" strokeWidth={1.75} />
                </Link>
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}



