"use client";

import Link from "next/link";
import { useEffect, useActionState } from "react";
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
      <Button type="submit" variant="outline" size="sm" disabled={pending}>
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
      <Button type="submit" variant="outline" size="sm" disabled={pending}>
        {pending ? "Saving…" : "Mark all read"}
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
  const unreadCount = notifications.filter((n) => !n.read_at).length;

  // The server already fetched this list; when it is complete the badge can
  // be aligned to ground truth at zero extra queries.
  useEffect(() => {
    if (listComplete) syncFromList(unreadCount);
  }, [listComplete, unreadCount, syncFromList]);

  if (notifications.length === 0) {
    return (
      <p className="text-ink-muted-48">No notifications yet.</p>
    );
  }

  return (
    <div className="space-y-4">
      {unreadCount > 0 ? (
        <div className="flex justify-end">
          <MarkAllReadButton />
        </div>
      ) : null}
      <ul className="divide-y divide-hairline border border-hairline">
        {notifications.map((notification) => {
          const label =
            notification.days_before == null
              ? "Reminder"
              : urgencyLabel(notification.days_before);
          const unread = !notification.read_at;

          return (
            <li
              key={notification.id}
              className={`flex flex-wrap items-start justify-between gap-3 px-4 py-3 ${
                unread ? "bg-muted/40" : ""
              }`}
            >
              <div className="space-y-1">
                <p className="text-sm font-medium text-ink">
                  <span className="text-primary">{label}</span>
                  {" · "}
                  {notification.task_title ?? "Task"}
                </p>
                <p className="text-xs text-ink-muted-48">
                  {notification.sent_at
                    ? formatDeadline(notification.sent_at, timeZone, timeFormat)
                    : "—"}
                  {unread ? " · Unread" : " · Read"}
                </p>
                <Link
                  href={`/tasks/${notification.task_id}`}
                  className="text-xs text-primary hover:underline"
                >
                  Open task
                </Link>
              </div>
              {unread ? <MarkReadButton id={notification.id} /> : null}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
