"use client";

import Link from "next/link";
import { useActionState } from "react";

import {
  markAllNotificationsRead,
  markNotificationRead,
  type NotificationActionState,
} from "@/app/actions/notifications";
import { Button } from "@/components/ui/button";
import { urgencyLabel } from "@/lib/reminders/urgency";
import type { InAppNotification } from "@/types/notification";

const initialState: NotificationActionState = {};

function MarkReadButton({ id }: { id: string }) {
  const [, action, pending] = useActionState(
    markNotificationRead,
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
  const [, action, pending] = useActionState(
    markAllNotificationsRead,
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
}: {
  notifications: InAppNotification[];
}) {
  const unreadCount = notifications.filter((n) => !n.read_at).length;

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
                    ? new Date(notification.sent_at).toLocaleString()
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
