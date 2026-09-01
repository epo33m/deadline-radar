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
        <h1 className="font-display text-3xl font-semibold">Settings</h1>
        <p className="text-sm text-destructive" role="alert">
          Could not load your profile. Apply the profiles migration in Supabase
          if you have not already.
        </p>
      </section>
    );
  }

  return (
    <section className="space-y-6">
      <div className="space-y-2">
        <h1 className="font-display text-3xl font-semibold">Settings</h1>
        <p className="text-ink-muted-48">
          Confirm the timezone used for reminder timing.
        </p>
      </div>
      <div className="space-y-1 text-sm">
        <p>
          <span className="text-ink-muted-48">Email: </span>
          {profile.email}
        </p>
      </div>
      <TimezoneForm initialTimezone={profile.timezone} />
    </section>
  );
}
