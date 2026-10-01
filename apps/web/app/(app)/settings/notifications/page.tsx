import { listInAppNotifications } from "@/app/actions/notifications";
import { NotificationList } from "@/components/notifications/notification-list";
import { PageHeader } from "@/components/ui/page-header";
import { requireSession } from "@/lib/api/session";

export default async function SettingsNotificationsPage() {
  const user = await requireSession();
  const list = await listInAppNotifications();

  return (
    <>
      <PageHeader
        title="Notifications"
        subtitle="In-app reminders for your upcoming deadlines."
      />

      <section className="pt-6 sm:pt-8">
        <NotificationList
          notifications={list.items}
          listComplete={list.complete}
          timeZone={user.timezone}
          timeFormat={user.timeFormat}
        />
      </section>
    </>
  );
}
