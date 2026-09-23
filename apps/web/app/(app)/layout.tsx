import { AppShell } from "@/components/shell/app-shell";
import { requireSession } from "@/lib/api/session";

export default async function AppLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const user = await requireSession();
  const accountLabel = user.email?.split("@")[0] ?? "Account";

  return (
    <>
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-[80] focus:rounded-lg focus:bg-canvas focus:px-4 focus:py-2 focus:text-sm focus:font-semibold focus:text-ink focus:ring-2 focus:ring-primary-focus"
      >
        Skip to content
      </a>
      <AppShell
        accountLabel={accountLabel}
        userEmail={user.email ?? ""}
      >
        {children}
      </AppShell>
    </>
  );
}
