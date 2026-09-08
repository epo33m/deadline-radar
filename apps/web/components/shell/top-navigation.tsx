"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Menu, X } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";

import { AccountMenu } from "@/components/shell/account-menu";
import { NotificationBell } from "@/components/notifications/notification-bell";
import { PortalMenu } from "@/components/ui/portal-menu";
import { shellContainerClassName } from "@/components/ui/shell-layout";
import {
  PRIMARY_NAV_ITEMS,
  isNavItemActive,
  type NavItem,
} from "@/lib/navigation";
import { cn } from "@/lib/utils";

type TopNavigationProps = {
  accountLabel: string;
  userEmail: string;
};

/** Must match Tailwind's `md` (48rem = 768px) breakpoint used for the nav layout. */
const COMPACT_NAV_QUERY = "(min-width: 768px)";

const iconButtonClassName =
  "inline-flex size-11 shrink-0 items-center justify-center rounded-lg text-ink-muted-48 transition-[color,background-color,transform] hover:bg-muted hover:text-ink active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-focus";

const navLinkClassName = (active: boolean) =>
  cn(
    "rounded-sm px-2 py-2 text-sm leading-tight whitespace-nowrap tracking-[-0.224px] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-focus",
    active
      ? "font-semibold text-ink"
      : "text-ink-muted-80 hover:text-ink",
  );

function MenuItemLink({
  item,
  active,
  onNavigate,
}: {
  item: NavItem;
  active: boolean;
  onNavigate: () => void;
}) {
  return (
    <Link
      href={item.href}
      onClick={onNavigate}
      aria-current={active ? "page" : undefined}
      className={cn(
        "flex min-h-11 items-center gap-3 px-4 text-[17px] tracking-[-0.374px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-focus",
        active ? "font-semibold text-ink" : "font-normal text-ink-muted-80",
      )}
    >
      <item.icon
        className={cn(
          "size-4 shrink-0",
          active ? "text-ink" : "text-ink-muted-48",
        )}
        strokeWidth={active ? 2.5 : 2}
        aria-hidden="true"
      />
      <span>{item.label}</span>
    </Link>
  );
}

export function TopNavigation({
  accountLabel,
  userEmail,
}: TopNavigationProps) {
  const pathname = usePathname();
  const menuId = useId();
  const menuButtonRef = useRef<HTMLButtonElement>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [isCompactNav, setIsCompactNav] = useState(false);
  const [openedPathname, setOpenedPathname] = useState<string | null>(null);

  useEffect(() => {
    const mediaQuery = window.matchMedia(COMPACT_NAV_QUERY);

    function handleChange(event: MediaQueryListEvent | MediaQueryList) {
      setIsCompactNav(!event.matches);
      if (event.matches) {
        setMenuOpen(false);
      }
    }

    handleChange(mediaQuery);
    mediaQuery.addEventListener("change", handleChange);
    return () => mediaQuery.removeEventListener("change", handleChange);
  }, []);

  // Safety net: close the mobile menu when the route changes outside a menu
  // click (the click handler itself already closes it).
  if (menuOpen && openedPathname !== null && openedPathname !== pathname) {
    setMenuOpen(false);
  }

  function closeMenu() {
    setMenuOpen(false);
  }

  function toggleMenu() {
    const next = !menuOpen;
    setMenuOpen(next);
    if (next) setOpenedPathname(pathname);
  }

  function handleMenuNavigate() {
    setMenuOpen(false);
  }

  return (
    <header className="sticky top-0 z-30 bg-surface-pearl supports-[backdrop-filter]:bg-surface-pearl/80 supports-[backdrop-filter]:backdrop-blur-xl supports-[backdrop-filter]:backdrop-saturate-150">
      <div className={cn(shellContainerClassName, "flex h-13 items-center justify-between gap-6")}>
        <div className="flex min-w-0 items-center gap-2 md:gap-6">
          <Link
            href="/overview"
            className="min-w-0 truncate rounded-sm font-sans text-[17px] font-semibold leading-tight tracking-[-0.374px] text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-focus"
          >
            Deadline Radar
          </Link>

          <nav aria-label="Primary" className="hidden md:block">
            <ul className="flex items-center gap-6">
              {PRIMARY_NAV_ITEMS.map((item) => (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    aria-current={
                      isNavItemActive(pathname, item.href) ? "page" : undefined
                    }
                    className={navLinkClassName(
                      isNavItemActive(pathname, item.href),
                    )}
                  >
                    {item.label}
                  </Link>
                </li>
              ))}
            </ul>
          </nav>
        </div>

        <div className="flex shrink-0 items-center gap-1 sm:gap-2">
          <NotificationBell />

          <AccountMenu accountLabel={accountLabel} userEmail={userEmail} />

          <button
            ref={menuButtonRef}
            type="button"
            onClick={toggleMenu}
            aria-label={menuOpen ? "Close navigation" : "Open navigation"}
            aria-expanded={menuOpen}
            aria-controls={menuId}
            className={cn(iconButtonClassName, "md:hidden")}
          >
            {menuOpen ? (
              <X className="size-5" aria-hidden="true" />
            ) : (
              <Menu className="size-5" aria-hidden="true" />
            )}
          </button>
        </div>
      </div>

      <PortalMenu
        open={menuOpen && isCompactNav}
        onClose={closeMenu}
        triggerRef={menuButtonRef}
        menuId={menuId}
        label="Navigation"
        role="none"
        focusFirstOnOpen
        measureOptions={{ fullWidth: true, disableSheet: true }}
        className="border-0 motion-safe:animate-in motion-safe:fade-in motion-safe:slide-in-from-top-2 motion-safe:duration-200 motion-safe:ease-out"
      >
        <nav
          aria-label="Primary"
          className="min-h-0 flex-1 overflow-y-auto overscroll-contain"
        >
          <ul className="flex flex-col py-2">
            {PRIMARY_NAV_ITEMS.map((item) => (
              <li key={item.href}>
                <MenuItemLink
                  item={item}
                  active={isNavItemActive(pathname, item.href)}
                  onNavigate={handleMenuNavigate}
                />
              </li>
            ))}
          </ul>
        </nav>
      </PortalMenu>
    </header>
  );
}