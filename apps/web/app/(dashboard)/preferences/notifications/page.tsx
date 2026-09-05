import Link from "next/link";

import { listInAppNotifications } from "@/app/actions/notifications";
import { NotificationList } from "@/components/notifications/notification-list";
import { requireSession } from "@/lib/api/session";

export default async function PreferencesNotificationsPage() {
  await requireSession();
  const notifications = await listInAppNotifications();

  return (
    <section className="space-y-6 sm:space-y-8">
      <div className="space-y-3">
        <Link
          href="/preferences"
          className="inline-flex text-[15px] font-medium text-primary outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
        >
          Preferences
        </Link>
        <header className="space-y-2 sm:space-y-3">
          <h1 className="font-display text-[32px] font-semibold leading-[1.07] tracking-[-0.28px] text-ink sm:text-[36px] lg:text-[44px]">
            Notifications
          </h1>
          <p className="max-w-xl text-[15px] font-normal leading-[1.47] tracking-[-0.374px] text-ink-muted-48 sm:text-[17px]">
            In-app reminders for your upcoming deadlines.
          </p>
        </header>
      </div>
      <NotificationList notifications={notifications} />
    </section>
  );
}
