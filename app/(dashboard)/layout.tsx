import { redirect } from "next/navigation";

import { DashboardShell } from "@/components/dashboard/dashboard-shell";
import { createClient } from "@/lib/supabase/server";

export default async function DashboardShellLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const accountLabel = user.email?.split("@")[0] ?? "Account";

  return (
    <DashboardShell
      accountLabel={accountLabel}
      userEmail={user.email ?? ""}
    >
      {children}
    </DashboardShell>
  );
}
