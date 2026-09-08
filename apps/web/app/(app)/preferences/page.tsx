import { AccountList } from "@/components/preferences/account-list";
import { PreferencesList } from "@/components/preferences/preferences-list";
import {
  formSectionGapClassName,
  formTitleGapClassName,
} from "@/components/ui/form-layout";
import { requireSession } from "@/lib/api/session";
import { cn } from "@/lib/utils";

export default async function PreferencesPage() {
  const user = await requireSession();

  return (
    <section className="flex w-full flex-col">
      <header className="space-y-2 sm:space-y-3">
        <h1 className="font-display text-[32px] font-semibold leading-[1.07] tracking-[-0.28px] text-ink sm:text-[36px] lg:text-[44px]">
          Preferences
        </h1>
        <p className="max-w-xl text-[15px] font-normal leading-[1.47] tracking-[-0.374px] text-ink-muted-64 sm:text-[17px]">
          Account and time zone.
        </p>
      </header>

      <div className={cn(formTitleGapClassName, formSectionGapClassName)}>
        <AccountList email={user.email ?? ""} pendingEmail={user.pendingEmail} />
        <PreferencesList timezone={user.timezone} />
      </div>
    </section>
  );
}
