import { AccountList } from "@/components/preferences/account-list";
import { PreferencesList } from "@/components/preferences/preferences-list";
import { requireSession } from "@/lib/api/session";

export default async function PreferencesPage() {
  const user = await requireSession();

  return (
    <section className="space-y-6 sm:space-y-8">
      <header className="space-y-2 sm:space-y-3">
        <h1 className="font-display text-[32px] font-semibold leading-[1.07] tracking-[-0.28px] text-ink sm:text-[36px] lg:text-[44px]">
          Preferences
        </h1>
        <p className="max-w-xl text-[15px] font-normal leading-[1.47] tracking-[-0.374px] text-ink-muted-48 sm:text-[17px]">
          Account and time zone.
        </p>
      </header>

      <div className="space-y-6 sm:space-y-8">
        <section
          aria-labelledby="preferences-account-heading"
          className="space-y-3 sm:space-y-4"
        >
          <h2
            id="preferences-account-heading"
            className="font-display text-[19px] font-semibold tracking-[-0.2px] text-ink sm:text-[21px]"
          >
            Account
          </h2>
          <AccountList email={user.email ?? ""} pendingEmail={user.pendingEmail} />
        </section>

        <section
          aria-labelledby="preferences-general-heading"
          className="space-y-3 sm:space-y-4"
        >
          <h2
            id="preferences-general-heading"
            className="font-display text-[19px] font-semibold tracking-[-0.2px] text-ink sm:text-[21px]"
          >
            General
          </h2>
          <PreferencesList timezone={user.timezone} />
        </section>
      </div>
    </section>
  );
}
