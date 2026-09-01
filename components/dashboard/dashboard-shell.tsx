"use client";

import { useState } from "react";

import { AppSidebar } from "@/components/dashboard/app-sidebar";
import { AppTopBar } from "@/components/dashboard/app-top-bar";
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
  const [mobileNavOpen, setMobileNavOpen] = useState(false);

  return (
    <div className="min-h-screen bg-canvas text-ink">
      <div className="flex min-h-screen">
        <AppSidebar className="hidden lg:flex" />

        {mobileNavOpen ? (
          <button
            type="button"
            aria-label="Close navigation"
            className="fixed inset-0 z-40 bg-ink/20 lg:hidden"
            onClick={() => setMobileNavOpen(false)}
          />
        ) : null}

        <AppSidebar
          aria-hidden={!mobileNavOpen}
          className={cn(
            "fixed inset-y-0 left-0 z-50 transition-transform lg:hidden",
            mobileNavOpen ? "translate-x-0" : "-translate-x-full",
          )}
          onNavigate={() => setMobileNavOpen(false)}
        />

        <div className="flex min-w-0 flex-1 flex-col">
          <AppTopBar
            accountLabel={accountLabel}
            userEmail={userEmail}
            onOpenMobileNav={() => setMobileNavOpen(true)}
          />
          <main className="flex-1 px-4 py-6 lg:px-8 lg:py-8">
            <div className="mx-auto w-full max-w-6xl">{children}</div>
          </main>
        </div>
      </div>
    </div>
  );
}
