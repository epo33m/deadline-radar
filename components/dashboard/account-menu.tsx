"use client";

import Link from "next/link";
import { ChevronDown } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";

import { logout } from "@/app/actions/auth";

type AccountMenuProps = {
  accountLabel: string;
  userEmail: string;
};

export function AccountMenu({ accountLabel, userEmail }: AccountMenuProps) {
  const menuId = useId();
  const containerRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const initial = accountLabel.charAt(0).toUpperCase() || "A";

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
    <div ref={containerRef} className="relative min-w-0 flex-1">
      <button
        type="button"
        aria-expanded={open}
        aria-haspopup="menu"
        aria-controls={menuId}
        aria-label={`Account menu for ${accountLabel}`}
        onClick={() => setOpen((current) => !current)}
        className="inline-flex w-full min-w-0 items-center gap-1 rounded-lg px-2 py-1.5 text-sm text-ink transition-colors hover:bg-sidebar-accent/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink-muted-80"
      >
        <span className="inline-flex size-7 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-medium text-ink">
          {initial}
        </span>
        <span className="min-w-0 flex-1 truncate text-left">{accountLabel}</span>
        <ChevronDown className="size-4 shrink-0 text-ink-muted-48" aria-hidden="true" />
      </button>

      {open ? (
        <div
          id={menuId}
          role="menu"
          className="absolute top-full right-0 left-0 z-50 mt-1 min-w-[12rem] rounded-xl border border-hairline bg-canvas py-1 shadow-sm"
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
