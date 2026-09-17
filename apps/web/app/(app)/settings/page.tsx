import { AccountList } from "@/components/settings/account-list";
import { SettingsList } from "@/components/settings/settings-list";
import { PageHeader } from "@/components/ui/page-header";
import { requireSession } from "@/lib/api/session";

export default async function SettingsPage() {
  const user = await requireSession();

  return (
    <>
      <PageHeader title="Settings" subtitle="Manage your account and preferences." />

      <section className="pt-6 sm:pt-8">
        <div className="space-y-2">
          <h2 className="font-display text-[15px] font-semibold tracking-[-0.2px] text-ink">
            Account
          </h2>
          <AccountList email={user.email ?? ""} pendingEmail={user.pendingEmail} />
        </div>
        <div className="mt-6 space-y-2">
          <h2 className="font-display text-[15px] font-semibold tracking-[-0.2px] text-ink">
            General
          </h2>
          <SettingsList timezone={user.timezone} timeFormat={user.timeFormat} />
        </div>
      </section>
    </>
  );
}
