import Link from "next/link";

import {
  chromeSurfaceClassName,
  shellContainerClassName,
} from "@/components/ui/shell-layout";
import { LEGAL_ENTITY_NAME, LEGAL_LINKS } from "@/lib/legal";
import { cn } from "@/lib/utils";

/**
 * Public footer for the marketing/landing surface, shared by `/` and the legal
 * pages.
 *
 * "How it works" anchors to the section on `/` rather than linking a route of
 * its own: that content used to live at `/get-started`, and the route is gone.
 *
 * The ground is `chromeSurfaceClassName` — the exact class string `LandingNav`
 * uses, so the nav and the footer are the same colour rather than two
 * near-identical literals. Sharing the constant is the point: a bare
 * `bg-surface-pearl` here is one point lighter than the nav's 80% composite and
 * reads as a mismatched band.
 *
 * That surface sits barely off the parchment page (#f5f5f7), so the footer has
 * no hard edge of its own. There is no top hairline: the region is held apart by
 * the `py-16` of air above the content, not by a rule.
 *
 * Only routes that exist are linked. There is no marketing sitemap, so there is
 * no "Company"/"Support"/"Resources" column to invent — a column of dead links
 * is worse than a short one. Sign-in and registration are not repeated here
 * either: `LandingNav` already carries a `Sign in` pill on every public page, so
 * a second set in the footer is duplicate chrome, not information architecture.
 */

/** `fine-print` — 12px / 400 / 1.0 / -0.12px. */
const finePrintClassName =
  "text-xs leading-none font-normal tracking-[-0.12px] text-ink-muted-48";

/** `fine-print` as a link, dimmed to match the copyright line it sits beside. */
const legalLinkClassName =
  "relative rounded-sm text-xs leading-none font-normal tracking-[-0.12px] text-ink-muted-48 transition-colors before:absolute before:inset-x-0 before:-inset-y-3 before:content-[''] [@media(hover:hover)]:hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-focus focus-visible:ring-offset-2 focus-visible:ring-offset-surface-pearl";

export function LandingFooter() {
  const year = new Date().getFullYear();

  return (
    <footer className={chromeSurfaceClassName}>
      <div className={cn(shellContainerClassName, "py-8 sm:py-10")}>
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between sm:gap-6">
          <p className={finePrintClassName}>
            &copy; {year} {LEGAL_ENTITY_NAME}. All rights reserved.
          </p>
          <ul className="flex flex-wrap items-center gap-x-6 gap-y-2">
            {LEGAL_LINKS.map((link) => (
              <li key={link.href}>
                <Link href={link.href} className={legalLinkClassName}>
                  {link.label}
                </Link>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </footer>
  );
}
