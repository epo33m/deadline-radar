import { redirect } from "next/navigation";

import { PreferencesList } from "@/components/preferences/preferences-list";
import { createClient } from "@/lib/supabase/server";
import type { Profile } from "@/types/profile";

export default async function PreferencesPage() {
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
          Preferences
        </h1>
        <p className="text-sm text-destructive" role="alert">
          Could not load your profile. Apply the profiles migration in Supabase
          if you have not already.
        </p>
      </section>
    );
  }

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
          <ul className="list-none overflow-hidden rounded-xl border border-hairline bg-canvas">
            <li className="flex min-h-12 items-center justify-between gap-4 px-3 py-3 sm:px-4 sm:py-3.5">
              <span className="shrink-0 text-[17px] font-medium leading-snug tracking-[-0.2px] text-ink">
                Email
              </span>
              <span className="min-w-0 truncate text-[15px] text-ink-muted-80 sm:text-[17px]">
                {profile.email}
              </span>
            </li>
          </ul>
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
          <PreferencesList timezone={profile.timezone} />
        </section>
      </div>
    </section>
  );
}
