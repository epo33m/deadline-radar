import { ListPager } from "@/components/ui/list-pager";
import { listInAppNotifications } from "@/app/actions/notifications";
import { NotificationList } from "@/components/notifications/notification-list";
import { PageHeader } from "@/components/ui/page-header";
import { requireSession } from "@/lib/api/session";
import { withPageCount } from "@/lib/paging/href";
import { parsePageCount } from "@/lib/paging/page-count";

type SettingsNotificationsPageProps = {
  searchParams: Promise<{ pages?: string | string[] }>;
};

export default async function SettingsNotificationsPage({
  searchParams,
}: SettingsNotificationsPageProps) {
  const [{ pages: rawPages }, user] = await Promise.all([
    searchParams,
    requireSession(),
  ]);

  const pageCount = parsePageCount(rawPages);
  const list = await listInAppNotifications({ pages: pageCount });

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
          pager={
            list.items.length > 0 ? (
              <ListPager
                loadedCount={list.items.length}
                nextPageHref={
                  list.nextCursor
                    ? withPageCount("/settings/notifications", {}, pageCount + 1)
                    : undefined
                }
                truncated={list.truncated}
                noun="reminder"
                nounPlural="reminders"
              />
            ) : null
          }
        />
      </section>
    </>
  );
}
