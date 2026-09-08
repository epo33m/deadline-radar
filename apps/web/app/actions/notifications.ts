"use server";

import { revalidatePath } from "next/cache";

import { apiJson } from "@/lib/api/server";
import type { InAppNotification } from "@/types/notification";

export type NotificationActionState = {
  error?: string;
  fieldErrors?: Partial<Record<string, string[]>>;
};

type ApiNotification = {
  id: string;
  taskId: string;
  thresholdId: string;
  channel: "email" | "in_app";
  status: "pending" | "sent" | "failed";
  retryCount: number;
  sentAt: string | Date | null;
  readAt: string | Date | null;
  createdAt: string | Date;
  taskTitle: string;
  daysBefore: number;
};

function mapNotification(row: ApiNotification): InAppNotification {
  return {
    id: row.id,
    task_id: row.taskId,
    threshold_id: row.thresholdId,
    channel: row.channel,
    status: row.status,
    retry_count: row.retryCount,
    sent_at:
      row.sentAt instanceof Date
        ? row.sentAt.toISOString()
        : (row.sentAt ?? null),
    read_at:
      row.readAt instanceof Date
        ? row.readAt.toISOString()
        : (row.readAt ?? null),
    created_at:
      row.createdAt instanceof Date
        ? row.createdAt.toISOString()
        : String(row.createdAt),
    task_title: row.taskTitle,
    days_before: row.daysBefore,
  };
}

export type InAppNotificationList = {
  items: InAppNotification[];
  /**
   * When true the fetched list has no further pages, so the unread count
   * can be derived from it exactly. Set to false on error to avoid syncing
   * an incorrect count (e.g. 0) into shared state.
   */
  complete: boolean;
};

export async function listInAppNotifications(): Promise<InAppNotificationList> {
  const result = await apiJson<{
    notifications?: ApiNotification[];
    page?: { nextCursor?: string | null };
  }>("/api/v1/notifications");
  if (result.error || !result.notifications) {
    return { items: [], complete: false };
  }
  return {
    items: result.notifications.map(mapNotification),
    complete: result.page?.nextCursor == null,
  };
}

export async function countUnreadInAppNotifications(): Promise<number> {
  const result = await apiJson<{ count?: number }>(
    "/api/v1/notifications/unread-count",
  );
  return result.count ?? 0;
}

export async function markNotificationRead(
  _prev: NotificationActionState,
  formData: FormData,
): Promise<NotificationActionState> {
  const id = formData.get("id");
  if (typeof id !== "string" || !id) {
    return { error: "Notification id is required." };
  }
  const result = await apiJson(`/api/v1/notifications/${id}/read`, {
    method: "POST",
  });
  if (result.error) {
    return { error: result.error, fieldErrors: result.fieldErrors };
  }
  revalidatePath("/preferences/notifications");
  return {};
}

export async function markAllNotificationsRead(
  _prev: NotificationActionState,
  formData: FormData,
): Promise<NotificationActionState> {
  void formData;
  const result = await apiJson("/api/v1/notifications/read-all", {
    method: "POST",
  });
  if (result.error) {
    return { error: result.error, fieldErrors: result.fieldErrors };
  }
  revalidatePath("/preferences/notifications");
  return {};
}
