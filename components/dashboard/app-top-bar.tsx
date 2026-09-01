"use client";

import Link from "next/link";
import { ChevronDown } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";

import { logout } from "@/app/actions/auth";
import { NotificationBell } from "@/components/notifications/notification-bell";

type AccountMenuProps = {
  accountLabel: string;
  userEmail: string;
};

export function AccountMenu({ accountLabel, userEmail }: AccountMenuProps) {
  const menuId = useId();
  const containerRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return;

    function handlePointerDown(event: MouseEvent) {
      if (
        containerRef.current &&
        !containerRef.current.contains(event.target as Node)
      ) {
        setOpen(false);
      }
    }

    function handleEscape(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }

    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleEscape);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleEscape);
    };
  }, [open]);

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        aria-expanded={open}
        aria-haspopup="menu"
        aria-controls={menuId}
        onClick={() => setOpen((current) => !current)}
        className="inline-flex items-center gap-1 rounded-lg px-2 py-1.5 text-sm text-ink transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-focus"
      >
        <span>{accountLabel}</span>
        <ChevronDown className="size-4 text-ink-muted-48" aria-hidden="true" />
      </button>

      {open ? (
        <div
          id={menuId}
          role="menu"
          className="absolute top-full right-0 z-50 mt-1 min-w-[12rem] rounded-xl border border-hairline bg-canvas py-1 shadow-sm"
        >
          <div className="border-b border-hairline px-3 py-2">
            <p className="text-sm font-medium text-ink">Account</p>
            {userEmail ? (
              <p className="truncate text-xs text-ink-muted-48">{userEmail}</p>
            ) : null}
          </div>
          <Link
            href="/settings"
            role="menuitem"
            onClick={() => setOpen(false)}
            className="block px-3 py-2 text-sm text-ink hover:bg-muted focus-visible:bg-muted focus-visible:outline-none"
          >
            Settings
          </Link>
          <form action={logout}>
            <button
              type="submit"
              role="menuitem"
              className="block w-full px-3 py-2 text-left text-sm text-ink hover:bg-muted focus-visible:bg-muted focus-visible:outline-none"
            >
              Sign out
            </button>
          </form>
        </div>
      ) : null}
    </div>
  );
}

type AppTopBarProps = {
  accountLabel: string;
  userEmail: string;
  onOpenMobileNav?: () => void;
};

export function AppTopBar({
  accountLabel,
  userEmail,
  onOpenMobileNav,
}: AppTopBarProps) {
  return (
    <header className="sticky top-0 z-30 border-b border-hairline bg-canvas/95 backdrop-blur-sm">
      <div className="flex h-14 items-center gap-3 px-4 lg:px-8">
        {onOpenMobileNav ? (
          <button
            type="button"
            onClick={onOpenMobileNav}
            className="inline-flex size-9 items-center justify-center rounded-lg text-ink-muted-48 hover:bg-muted hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-focus lg:hidden"
            aria-label="Open navigation"
          >
            <span className="flex flex-col gap-1" aria-hidden="true">
              <span className="block h-0.5 w-4 rounded-full bg-current" />
              <span className="block h-0.5 w-4 rounded-full bg-current" />
              <span className="block h-0.5 w-4 rounded-full bg-current" />
            </span>
          </button>
        ) : null}

        <Link
          href="/dashboard"
          className="font-display text-sm font-semibold text-ink lg:hidden"
        >
          Deadline Radar
        </Link>

        <div className="hidden flex-1 lg:block">
          <Link
            href="/dashboard"
            className="font-display text-sm font-semibold text-ink"
          >
            Deadline Radar
          </Link>
        </div>

        <div className="ml-auto flex items-center gap-2">
          <NotificationBell />
          <AccountMenu accountLabel={accountLabel} userEmail={userEmail} />
        </div>
      </div>
    </header>
  );
}
