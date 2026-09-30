"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ChevronDown, PanelLeft } from "lucide-react";
import { useEffect, useState } from "react";

import { shellContainerClassName } from "@/components/ui/shell-layout";
import { cn } from "@/lib/utils";

const LEARN_LINKS: { id: string; label: string; href: string }[] = [
  { id: "course", label: "Course", href: "/courses" },
  { id: "task", label: "Task", href: "/tasks" },
  { id: "calendar", label: "Calendar", href: "/calendar" },
];

/**
 * Secondary navigation shared by the Learn group (Courses, Tasks, Calendar).
 * Matches Apple Developer design system:
 * - Desktop/Tablet: horizontal tabs on the right.
 * - Mobile: subnav header with a chevron that opens an overlay dropdown
 *   with hairline dividers floating on top of the content (without pushing layout).
 */
export function LearnSecondaryNav({
  onOpenSidebar,
  openSidebarLabel = "Open sections",
}: {
  onOpenSidebar?: () => void;
  openSidebarLabel?: string;
} = {}) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [openedPathname, setOpenedPathname] = useState<string | null>(null);

  // Safety net: close mobile menu during render if pathname changed outside a click
  if (open && openedPathname !== null && openedPathname !== pathname) {
    setOpen(false);
  }

  function toggleOpen() {
    const next = !open;
    setOpen(next);
    if (next) {
      setOpenedPathname(pathname);
    }
  }

  // Handle Escape key to close mobile menu
  useEffect(() => {
    if (!open) return;

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setOpen(false);
      }
    }

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [open]);

  return (
    <>
      {/* Mobile Backdrop Overlay: dims content below and captures outside clicks */}
      {open ? (
        <div
          aria-hidden="true"
          onClick={() => setOpen(false)}
          className="fixed inset-0 z-20 bg-ink/30 sm:hidden"
        />
      ) : null}

      <div
        className={cn(
          "relative left-1/2 -mt-5 w-screen -translate-x-1/2 border-b border-hairline bg-canvas sm:-mt-6 lg:-mt-8",
          open ? "z-30" : "z-10",
        )}
      >
        <div
          className={cn(
            shellContainerClassName,
            "flex items-center justify-between gap-4 py-3 sm:py-0",
          )}
        >
          <div className="flex min-w-0 items-center">
            {onOpenSidebar ? (
              <>
                <button
                  type="button"
                  onClick={onOpenSidebar}
                  aria-label={openSidebarLabel}
                  className="-ml-2 mr-2.5 inline-flex size-9 shrink-0 items-center justify-center rounded-md text-ink transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-focus lg:hidden"
                >
                  <PanelLeft
                    className="size-5"
                    strokeWidth={2.25}
                    aria-hidden="true"
                  />
                </button>
                <span
                  aria-hidden="true"
                  className="mx-2.5 h-5 w-[1.5px] shrink-0 bg-ink lg:hidden"
                />
              </>
            ) : null}
            <p
              className={cn(
                "min-w-0 truncate text-[22px] font-semibold leading-tight",
                onOpenSidebar ? "ml-2.5 lg:ml-0" : undefined,
              )}
            >
              Learn
            </p>
          </div>

          {/* Mobile Chevron toggle button */}
          <div className="flex items-center sm:hidden">
            <button
              type="button"
              aria-expanded={open}
              aria-label={
                open
                  ? "Close Learn navigation menu"
                  : "Open Learn navigation menu"
              }
              onClick={toggleOpen}
              className="-mr-2 inline-flex size-9 items-center justify-center rounded-md text-ink transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-focus"
            >
              <ChevronDown
                className={cn(
                  "size-5 text-ink transition-transform duration-200",
                  open && "rotate-180",
                )}
                aria-hidden="true"
                strokeWidth={2}
              />
            </button>
          </div>

          {/* Desktop / Tablet Navigation: visible on sm and up */}
          <nav
            aria-label="Learn sections"
            className="-mb-px -mr-3 hidden justify-end gap-1 overflow-x-auto sm:flex sm:gap-2"
          >
            {LEARN_LINKS.map((item) => {
              const selected =
                pathname === item.href || pathname.startsWith(`${item.href}/`);
              return (
                <Link
                  key={item.id}
                  href={item.href}
                  aria-current={selected ? "page" : undefined}
                  className={cn(
                    "whitespace-nowrap border-b-2 px-3 py-3 text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-focus",
                    selected
                      ? "border-ink font-semibold text-ink"
                      : "border-transparent text-ink-muted-80 hover:text-ink",
                  )}
                >
                  {item.label}
                </Link>
              );
            })}
          </nav>
        </div>

        {/* Mobile Dropdown Overlay Menu: floats over the content below */}
        {open ? (
          <div
            role="dialog"
            aria-label="Learn navigation menu"
            className="absolute top-full left-0 z-30 w-full border-b border-hairline bg-canvas shadow-lg sm:hidden"
          >
            <div className={shellContainerClassName}>
              <nav aria-label="Mobile Learn sections">
                <ul className="flex flex-col divide-y divide-hairline py-1">
                  {LEARN_LINKS.map((item) => {
                    const selected =
                      pathname === item.href ||
                      pathname.startsWith(`${item.href}/`);
                    return (
                      <li key={item.id}>
                        <Link
                          href={item.href}
                          onClick={() => setOpen(false)}
                          aria-current={selected ? "page" : undefined}
                          className={cn(
                            "flex items-center justify-between py-3.5 text-[15px] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-focus",
                            selected
                              ? "font-semibold text-ink"
                              : "text-ink-muted-80 hover:text-ink",
                          )}
                        >
                          <span>{item.label}</span>
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              </nav>
            </div>
          </div>
        ) : null}
      </div>
    </>
  );
}
