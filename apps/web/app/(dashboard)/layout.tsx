import { DashboardShell } from "@/components/dashboard/dashboard-shell";
import { requireSession } from "@/lib/api/session";

export default async function DashboardShellLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const user = await requireSession();
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
