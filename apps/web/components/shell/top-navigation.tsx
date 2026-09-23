"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Menu, X } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";

import { AccountMenu } from "@/components/shell/account-menu";
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
        "flex min-h-18 items-center px-6 text-[30px] leading-[1.1] tracking-[-0.6px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-focus",
        active ? "font-semibold text-ink" : "font-normal text-ink-muted-80",
      )}
    >
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
  const [openedPathname, setOpenedPathname] = useState<string | null>(null);

  useEffect(() => {
    const mediaQuery = window.matchMedia(COMPACT_NAV_QUERY);

    function handleChange(event: MediaQueryListEvent | MediaQueryList) {
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
    <>
    <header className="sticky top-0 z-30 bg-surface-pearl supports-[backdrop-filter]:bg-surface-pearl/80 supports-[backdrop-filter]:backdrop-blur-xl supports-[backdrop-filter]:backdrop-saturate-150">
      <div className={cn(shellContainerClassName, "relative flex h-13 items-center justify-between gap-6")}>
        <div className="flex min-w-0 shrink-0 items-center">
          <Link
            href="/summary"
            className="min-w-0 truncate rounded-sm font-sans text-[17px] font-semibold leading-tight tracking-[-0.374px] text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-focus"
          >
            Deadline Radar
          </Link>
        </div>

        <nav
          aria-label="Primary"
          className="absolute left-1/2 hidden -translate-x-1/2 md:block"
        >
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

        <div className="flex shrink-0 items-center gap-1 sm:gap-2">
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
    </header>

      {menuOpen ? (
        <div
          aria-hidden="true"
          onClick={closeMenu}
          className="fixed inset-0 z-40 bg-ink/30 md:hidden"
        />
      ) : null}

      <div
        id={menuId}
        role="dialog"
        aria-label="Navigation"
        aria-modal={menuOpen}
        className={cn(
          "fixed inset-x-0 top-0 bottom-0 z-50 flex w-full flex-col overflow-y-auto overscroll-contain border-b border-hairline bg-canvas transition-transform duration-200 ease-out md:hidden",
          menuOpen ? "translate-y-0" : "-translate-y-full",
        )}
      >
        <div className="flex shrink-0 items-center justify-end px-4 pt-[max(0.75rem,env(safe-area-inset-top))]">
          <button
            type="button"
            onClick={closeMenu}
            aria-label="Close navigation"
            className="inline-flex size-9 items-center justify-center rounded-md text-ink-muted-48 transition-colors hover:bg-muted hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-focus"
          >
            <X className="size-5" strokeWidth={2} aria-hidden="true" />
          </button>
        </div>
        <nav
          aria-label="Primary"
          className="min-h-0 flex-1 overflow-y-auto overscroll-contain"
        >
          <ul className="flex flex-col px-2 pt-1 pb-4">
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
      </div>
    </>
  );
}