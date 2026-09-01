"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { PanelLeft, PanelLeftClose, X } from "lucide-react";

import { AccountMenu } from "@/components/dashboard/account-menu";
import {
  APP_NAV_GROUPS,
  isNavItemActive,
  type NavItem,
} from "@/lib/dashboard/navigation";
import { cn } from "@/lib/utils";

const sidebarIconButtonClassName =
  "inline-flex size-9 shrink-0 items-center justify-center rounded-lg text-ink-muted-48 transition-colors hover:bg-sidebar-accent/60 hover:text-sidebar-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink-muted-80";

type AppSidebarProps = {
  variant?: "desktop" | "mobile";
  expanded: boolean;
  onToggleExpanded?: () => void;
  onClose?: () => void;
  accountLabel: string;
  userEmail: string;
  onNavigate?: () => void;
  className?: string;
};

function SidebarNavLink({
  item,
  active,
  expanded,
  onNavigate,
}: {
  item: NavItem;
  active: boolean;
  expanded: boolean;
  onNavigate?: () => void;
}) {
  return (
    <Link
      href={item.href}
      onClick={onNavigate}
      aria-current={active ? "page" : undefined}
      aria-label={item.label}
      title={item.label}
      className={cn(
        "group flex items-center rounded-lg text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink-muted-80",
        expanded
          ? "gap-2.5 px-2 py-2"
          : cn(sidebarIconButtonClassName, "mx-auto"),
        active
          ? "font-semibold text-ink"
          : expanded
            ? "text-ink-muted-48 hover:bg-sidebar-accent/60 hover:text-sidebar-foreground"
            : undefined,
      )}
    >
      <item.icon
        className={cn(
          "size-4 shrink-0 transition-colors",
          active
            ? "text-ink"
            : "text-ink-muted-48 group-hover:text-sidebar-foreground",
        )}
        strokeWidth={active ? 2.5 : 2}
        aria-hidden="true"
      />
      {expanded ? <span className="truncate">{item.label}</span> : null}
    </Link>
  );
}

export function AppSidebar({
  variant = "desktop",
  expanded,
  onToggleExpanded,
  onClose,
  accountLabel,
  userEmail,
  onNavigate,
  className,
}: AppSidebarProps) {
  const pathname = usePathname();
  const flatNavItems = APP_NAV_GROUPS.flatMap((group) => group.items);
  const isMobile = variant === "mobile";
  const showExpandedNav = isMobile || expanded;

  function handleNavigate() {
    onNavigate?.();
  }

  return (
    <aside
      className={cn(
        "flex shrink-0 flex-col border-r border-sidebar-border bg-sidebar py-4 transition-[width,padding,transform] duration-200 lg:sticky lg:top-0 lg:h-svh lg:min-h-svh",
        showExpandedNav ? "w-56 px-3" : "w-16 px-2",
        className,
      )}
    >
      <div
        className={cn(
          "mb-4 flex items-center gap-1",
          showExpandedNav ? "justify-between px-2" : "justify-center px-0",
        )}
      >
        {showExpandedNav ? (
          <AccountMenu accountLabel={accountLabel} userEmail={userEmail} />
        ) : null}

        {isMobile && onClose ? (
          <button
            type="button"
            onClick={onClose}
            aria-label="Close menu"
            className={sidebarIconButtonClassName}
          >
            <X className="size-4" aria-hidden="true" />
          </button>
        ) : onToggleExpanded ? (
          <button
            type="button"
            onClick={onToggleExpanded}
            aria-label={expanded ? "Collapse sidebar" : "Expand sidebar"}
            aria-expanded={expanded}
            className={sidebarIconButtonClassName}
          >
            {expanded ? (
              <PanelLeftClose className="size-4" aria-hidden="true" />
            ) : (
              <PanelLeft className="size-4" aria-hidden="true" />
            )}
          </button>
        ) : null}
      </div>

      <nav
        aria-label="Application"
        className="flex flex-1 flex-col overflow-y-auto overflow-x-hidden"
      >
        {showExpandedNav ? (
          <div className="flex flex-col gap-6">
            {APP_NAV_GROUPS.map((group) => (
              <div key={group.label} className="space-y-1">
                <p className="px-2 text-[11px] font-medium tracking-[0.08em] text-ink-muted-48 uppercase">
                  {group.label}
                </p>
                <ul className="space-y-0.5">
                  {group.items.map((item) => (
                    <li key={item.href}>
                      <SidebarNavLink
                        item={item}
                        active={isNavItemActive(pathname, item.href)}
                        expanded
                        onNavigate={handleNavigate}
                      />
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        ) : (
          <ul className="flex flex-col items-center gap-1">
            {flatNavItems.map((item) => (
              <li key={item.href}>
                <SidebarNavLink
                  item={item}
                  active={isNavItemActive(pathname, item.href)}
                  expanded={false}
                  onNavigate={handleNavigate}
                />
              </li>
            ))}
          </ul>
        )}
      </nav>
    </aside>
  );
}
