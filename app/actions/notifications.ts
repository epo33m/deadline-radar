"use server";

import { revalidatePath } from "next/cache";

import { createClient } from "@/lib/supabase/server";
import { markNotificationReadSchema } from "@/lib/validation/notification";
import type { InAppNotification } from "@/types/notification";

export type NotificationActionState = {
  error?: string;
  fieldErrors?: Partial<Record<string, string[]>>;
};

async function requireUser() {
  const supabase = await createClient();
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();

  if (error || !user) {
    return { supabase, user: null as null, error: "You must be signed in." };
  }

  return { supabase, user, error: null as null };
}

export async function listInAppNotifications(): Promise<InAppNotification[]> {
  const { supabase, user, error } = await requireUser();
  if (error || !user) return [];

  const { data, error: queryError } = await supabase
    .from("notification_deliveries")
    .select(
      `
      id,
      task_id,
      threshold_id,
      channel,
      status,
      retry_count,
      sent_at,
      read_at,
      created_at,
      tasks ( title ),
      reminder_thresholds ( days_before )
    `,
    )
    .eq("channel", "in_app")
    .eq("status", "sent")
    .order("sent_at", { ascending: false });

  if (queryError || !data) return [];

  return data.map((row) => {
    const task = row.tasks as { title: string } | { title: string }[] | null;
    const threshold = row.reminder_thresholds as
      | { days_before: number }
      | { days_before: number }[]
      | null;
    const taskTitle = Array.isArray(task)
      ? (task[0]?.title ?? null)
      : (task?.title ?? null);
    const daysBefore = Array.isArray(threshold)
      ? (threshold[0]?.days_before ?? null)
      : (threshold?.days_before ?? null);

    return {
      id: row.id,
      task_id: row.task_id,
      threshold_id: row.threshold_id,
      channel: row.channel,
      status: row.status,
      retry_count: row.retry_count,
      sent_at: row.sent_at,
      read_at: row.read_at,
      created_at: row.created_at,
      task_title: taskTitle,
      days_before: daysBefore,
    };
  });
}

export async function countUnreadInAppNotifications(): Promise<number> {
  const { supabase, user, error } = await requireUser();
  if (error || !user) return 0;

  const { count, error: queryError } = await supabase
    .from("notification_deliveries")
    .select("id", { count: "exact", head: true })
    .eq("channel", "in_app")
    .eq("status", "sent")
    .is("read_at", null);

  if (queryError) return 0;
  return count ?? 0;
}

export async function markNotificationRead(
  _prev: NotificationActionState,
  formData: FormData,
): Promise<NotificationActionState> {
  const parsed = markNotificationReadSchema.safeParse({
    id: formData.get("id"),
  });

  if (!parsed.success) {
    return {
      error: "Notification id is required.",
      fieldErrors: parsed.error.flatten().fieldErrors,
    };
  }

  const { supabase, user, error } = await requireUser();
  if (error || !user) return { error };

  const { error: updateError } = await supabase
    .from("notification_deliveries")
    .update({ read_at: new Date().toISOString() })
    .eq("id", parsed.data.id)
    .eq("channel", "in_app")
    .is("read_at", null);

  if (updateError) {
    return { error: updateError.message };
  }

  revalidatePath("/notifications");
  revalidatePath("/dashboard");
  return {};
}

export async function markAllNotificationsRead(
  _prev: NotificationActionState,
  _formData: FormData,
): Promise<NotificationActionState> {
  const { supabase, user, error } = await requireUser();
  if (error || !user) return { error };

  const { error: updateError } = await supabase
    .from("notification_deliveries")
    .update({ read_at: new Date().toISOString() })
    .eq("channel", "in_app")
    .eq("status", "sent")
    .is("read_at", null);

  if (updateError) {
    return { error: updateError.message };
  }

  revalidatePath("/notifications");
  revalidatePath("/dashboard");
  return {};
}
