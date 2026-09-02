import { redirect } from "next/navigation";

import { TimezoneForm } from "@/components/settings/timezone-form";
import { createClient } from "@/lib/supabase/server";
import type { Profile } from "@/types/profile";

export default async function SettingsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const { data: profile, error } = await supabase
    .from("profiles")
    .select("id, email, name, timezone, created_at")
    .eq("id", user.id)
    .single<Profile>();

  if (error || !profile) {
    return (
      <section className="space-y-2">
        <h1 className="font-display text-[32px] font-semibold leading-[1.07] tracking-[-0.28px] text-ink sm:text-[36px] lg:text-[44px]">
          Settings
        </h1>
        <p className="text-sm text-destructive" role="alert">
          Could not load your profile. Apply the profiles migration in Supabase
          if you have not already.
        </p>
      </section>
    );
  }

  return (
    <section className="mx-auto w-full max-w-2xl space-y-8 sm:space-y-10">
      <header className="space-y-2 sm:space-y-3">
        <h1 className="font-display text-[32px] font-semibold leading-[1.07] tracking-[-0.28px] text-ink sm:text-[36px] lg:text-[44px]">
          Settings
        </h1>
        <p className="max-w-xl text-[15px] font-normal leading-[1.47] tracking-[-0.374px] text-ink-muted-48 sm:text-[17px]">
          Manage your account and application preferences.
        </p>
      </header>

      <div className="space-y-8 sm:space-y-10">
        <section aria-labelledby="settings-account-heading" className="space-y-4">
          <h2
            id="settings-account-heading"
            className="text-[13px] font-semibold tracking-[0.06em] text-primary uppercase"
          >
            Account
          </h2>
          <div className="rounded-2xl border border-hairline bg-canvas px-4 py-4 sm:px-5 sm:py-5">
            <div className="space-y-1">
              <p className="text-[13px] font-medium text-ink-muted-48">Email</p>
              <p className="text-[17px] font-medium tracking-[-0.2px] text-ink">
                {profile.email}
              </p>
              <p className="text-[13px] leading-relaxed text-ink-muted-48">
                This is the email associated with your account.
              </p>
            </div>
          </div>
        </section>

        <section
          aria-labelledby="settings-preferences-heading"
          className="space-y-4"
        >
          <h2
            id="settings-preferences-heading"
            className="text-[13px] font-semibold tracking-[0.06em] text-primary uppercase"
          >
            Preferences
          </h2>
          <div className="rounded-2xl border border-hairline bg-canvas px-4 py-4 sm:px-5 sm:py-5">
            <TimezoneForm initialTimezone={profile.timezone} />
          </div>
        </section>
      </div>
    </section>
  );
}
