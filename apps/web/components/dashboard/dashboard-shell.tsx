"use client";

import { Menu } from "lucide-react";
import { useEffect, useState } from "react";

import { AppSidebar } from "@/components/dashboard/app-sidebar";
import { NotificationBell } from "@/components/notifications/notification-bell";
import { cn } from "@/lib/utils";

type DashboardShellProps = {
  accountLabel: string;
  userEmail: string;
  children: React.ReactNode;
};

export function DashboardShell({
  accountLabel,
  userEmail,
  children,
}: DashboardShellProps) {
  const [desktopSidebarExpanded, setDesktopSidebarExpanded] = useState(true);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);

  useEffect(() => {
    const mediaQuery = window.matchMedia("(min-width: 1024px)");

    function handleChange(event: MediaQueryListEvent | MediaQueryList) {
      if (event.matches) {
        setMobileNavOpen(false);
      }
    }

    handleChange(mediaQuery);
    mediaQuery.addEventListener("change", handleChange);
    return () => mediaQuery.removeEventListener("change", handleChange);
  }, []);

  function closeMobileNav() {
    setMobileNavOpen(false);
  }

  return (
    <div className="min-h-svh bg-canvas text-ink">
      <div className="flex min-h-svh">
        <AppSidebar
          variant="desktop"
          expanded={desktopSidebarExpanded}
          onToggleExpanded={() =>
            setDesktopSidebarExpanded((current) => !current)
          }
          accountLabel={accountLabel}
          userEmail={userEmail}
          className="hidden lg:flex"
        />

        {mobileNavOpen ? (
          <button
            type="button"
            aria-label="Close menu"
            className="fixed inset-0 z-40 bg-ink/20 lg:hidden"
            onClick={closeMobileNav}
          />
        ) : null}

        <AppSidebar
          variant="mobile"
          expanded
          onClose={closeMobileNav}
          onNavigate={closeMobileNav}
          accountLabel={accountLabel}
          userEmail={userEmail}
          className={cn(
            "fixed inset-y-0 left-0 z-50 lg:hidden",
            mobileNavOpen ? "translate-x-0" : "-translate-x-full",
          )}
        />

        <main className="min-w-0 flex-1">
          <div className="sticky top-0 z-30 flex h-14 items-center justify-between gap-3 border-b border-hairline bg-canvas px-4 sm:px-6 lg:px-8">
            <button
              type="button"
              onClick={() => setMobileNavOpen(true)}
              aria-label="Open menu"
              aria-expanded={mobileNavOpen}
              className="inline-flex size-11 shrink-0 items-center justify-center rounded-lg text-ink-muted-48 transition-colors hover:bg-muted hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-focus lg:invisible lg:pointer-events-none"
            >
              <Menu className="size-5" aria-hidden="true" />
            </button>

            <div className="flex items-center justify-end">
              <NotificationBell />
            </div>
          </div>

          <div className="px-4 py-5 sm:px-6 sm:py-6 lg:px-8 lg:py-8">
            <div className="mx-auto w-full max-w-6xl">{children}</div>
          </div>
        </main>
      </div>
    </div>
  );
}
