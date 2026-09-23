import type { DeliveryChannel, DeliveryStatus } from "@/lib/reminders/evaluate";

export type NotificationDelivery = {
  id: string;
  task_id: string;
  threshold_id: string;
  channel: DeliveryChannel;
  status: DeliveryStatus;
  retry_count: number;
  sent_at: string | null;
  read_at: string | null;
  created_at: string;
};

export type InAppNotification = NotificationDelivery & {
  task_title: string | null;
  days_before: number | null;
  /** RF-11: derive-on-read catch-up label (sent >= 1h after the trigger). */
  is_late: boolean;
};
