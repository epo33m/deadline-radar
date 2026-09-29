"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { PanelLeft } from "lucide-react";

import { shellContainerClassName } from "@/components/ui/shell-layout";
import { cn } from "@/lib/utils";

const LEARN_LINKS: { id: string; label: string; href: string }[] = [
  { id: "course", label: "Course", href: "/courses" },
  { id: "task", label: "Task", href: "/tasks" },
  { id: "calendar", label: "Calendar", href: "/calendar" },
];

/**
 * Secondary navigation shared by the Learn group (Courses, Tasks, Calendar).
 * Sits directly below the global nav; the active tab follows the current route
 * so the context stays visible on every page.
 */
export function LearnSecondaryNav({
  onOpenSidebar,
  openSidebarLabel = "Open sections",
}: {
  onOpenSidebar?: () => void;
  openSidebarLabel?: string;
} = {}) {
  const pathname = usePathname();

  return (
    <div className="relative left-1/2 -mt-5 w-screen -translate-x-1/2 border-b border-hairline bg-canvas sm:-mt-6 lg:-mt-8">
      <div
        className={cn(
          shellContainerClassName,
          "flex items-center justify-between gap-4",
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
        <nav
          aria-label="Learn sections"
          className="-mb-px -mr-3 flex justify-end gap-1 overflow-x-auto sm:gap-2"
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
    </div>
  );
}
