"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import {
  APP_NAV_GROUPS,
  isNavItemActive,
} from "@/lib/dashboard/navigation";
import { cn } from "@/lib/utils";

type AppSidebarProps = {
  onNavigate?: () => void;
  className?: string;
  "aria-hidden"?: boolean;
};

export function AppSidebar({
  onNavigate,
  className,
  "aria-hidden": ariaHidden,
}: AppSidebarProps) {
  const pathname = usePathname();

  return (
    <aside
      aria-hidden={ariaHidden}
      className={cn(
        "flex h-full w-56 shrink-0 flex-col border-r border-sidebar-border bg-sidebar px-3 py-5",
        className,
      )}
    >
      <div className="mb-6 hidden px-2 lg:block">
        <Link
          href="/dashboard"
          onClick={onNavigate}
          className="font-display text-sm font-semibold text-sidebar-foreground"
        >
          Deadline Radar
        </Link>
      </div>

      <nav aria-label="Application" className="flex flex-1 flex-col gap-6">
        {APP_NAV_GROUPS.map((group) => (
          <div key={group.label} className="space-y-1">
            <p className="px-2 text-[11px] font-medium tracking-[0.08em] text-ink-muted-48 uppercase">
              {group.label}
            </p>
            <ul className="space-y-0.5">
              {group.items.map((item) => {
                const active = isNavItemActive(pathname, item.href);

                return (
                  <li key={item.href}>
                    <Link
                      href={item.href}
                      onClick={onNavigate}
                      aria-current={active ? "page" : undefined}
                      className={cn(
                        "block rounded-lg px-2 py-2 text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sidebar-ring",
                        active
                          ? "bg-sidebar-accent font-medium text-sidebar-accent-foreground"
                          : "text-ink-muted-48 hover:bg-sidebar-accent/60 hover:text-sidebar-foreground",
                      )}
                    >
                      {item.label}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </nav>
    </aside>
  );
}
