import { listInAppNotifications } from "@/app/actions/notifications";
import { NotificationList } from "@/components/notifications/notification-list";

export default async function NotificationsPage() {
  const notifications = await listInAppNotifications();

  return (
    <section className="space-y-6">
      <div className="space-y-2">
        <h1 className="font-display text-3xl font-semibold">Notifications</h1>
        <p className="text-ink-muted-48">
          In-app reminders for your upcoming deadlines.
        </p>
      </div>
      <NotificationList notifications={notifications} />
    </section>
  );
}
