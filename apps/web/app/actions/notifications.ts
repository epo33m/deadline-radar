"use server";

import { revalidatePath } from "next/cache";

import { apiJson } from "@/lib/api/server";
import { LIST_MAX_PAGES, LIST_PAGE_LIMIT } from "@/lib/paging/limit";
import { loadPaged } from "@/lib/paging/load-pages";
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
  isLate: boolean;
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
    is_late: row.isLate,
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
  /**
   * Cursor left outstanding after the walk (#141). Present only while more
   * pages exist, which is what drives the "Load more" control.
   */
  nextCursor?: string | null;
  /** The walk hit the page cap, so older reminders are not shown. */
  truncated?: boolean;
};

/**
 * One page of in-app notifications with an explicit `limit` (#141). The API
 * default is 50, so without it anyone past 50 reminders hit a silent ceiling.
 */
async function fetchNotificationPage(cursor: string | null): Promise<{
  items: ApiNotification[];
  nextCursor: string | null;
}> {
  const qs = new URLSearchParams({ limit: String(LIST_PAGE_LIMIT) });
  if (cursor) qs.set("cursor", cursor);

  const result = await apiJson<{
    notifications?: ApiNotification[];
    page?: { nextCursor?: string | null };
  }>(`/api/v1/notifications?${qs.toString()}`);
  if (result.error || !result.notifications) {
    throw new Error(result.error ?? "Invalid notifications response");
  }
  return {
    items: result.notifications,
    nextCursor: result.page?.nextCursor ?? null,
  };
}

export async function listInAppNotifications(
  options: { pages?: number } = {},
): Promise<InAppNotificationList> {
  const pageCount = Math.max(1, Math.floor(options.pages ?? 1));
  const paged = await loadPaged(fetchNotificationPage, {
    maxPages: Math.min(pageCount, LIST_MAX_PAGES),
  });

  if (paged.error != null && paged.items.length === 0) {
    return { items: [], complete: false };
  }

  return {
    items: paged.items.map(mapNotification),
    // `complete` stays tied to the cursor running out, never to the page count
    // asked for: it is what makes the unread badge exact.
    complete: paged.complete,
    nextCursor: paged.nextCursor,
    truncated: paged.truncated,
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
  revalidatePath("/settings/notifications");
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
  revalidatePath("/settings/notifications");
  return {};
}
