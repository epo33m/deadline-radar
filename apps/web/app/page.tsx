import Link from "next/link";

import { EditorialShowcase } from "@/components/landing/editorial-showcase";
import { FadeIn } from "@/components/landing/fade-in";
import { FocusStatement } from "@/components/landing/focus-statement";
import { HeroNoteBoard } from "@/components/landing/hero-note-board";
import { HowItWorks } from "@/components/landing/how-it-works";
import { LandingFooter } from "@/components/landing/landing-footer";
import { LandingNav } from "@/components/landing/landing-nav";
import { NotificationShowcase } from "@/components/landing/notification-showcase";
import { shellContainerClassName } from "@/components/ui/shell-layout";
import { cn } from "@/lib/utils";

// SEC-002: strict nonce CSP requires dynamic rendering so Next can attach
// the per-request `x-nonce` to its inline scripts (static prerender has none).
export const dynamic = "force-dynamic";

/**
 * The two lines are inverted: the brand is the loud one and the promise sits
 * under it as quiet secondary copy, so the `h1` is the wordmark and the
 * tagline is the paragraph.
 *
 * The subhead holds one line at every viewport — it is short enough that it
 * only ever breaks on a phone too narrow to fit it, and `text-balance` keeps
 * that break even if it happens.
 *
 * Below the headline the hero ends at the note board, and the "How it works"
 * steps follow it on this same page — that section used to be the whole of
 * `/get-started`, which is why the CTA below is an anchor rather than a link to
 * a route.
 *
 * The root carries `overflow-x-clip` as a guard rather than a layout tool: the
 * outermost notes are positioned with negative insets so they can overhang the
 * board, and at the `lg` breakpoint that overhang reaches a few pixels past the
 * container padding. Clipping the x axis — and only the x axis, since unlike
 * `hidden` it does not turn the page into a scroll container — keeps the page
 * from growing a horizontal scrollbar.
 */
export default function HomePage() {
  return (
    <div className="flex min-h-svh flex-col overflow-x-clip bg-white font-sans text-ink">
      <LandingNav />

      <main className="flex flex-1 flex-col items-center">
        <section
          id="hero"
          aria-label="Hero"
          className="w-full bg-[#F5F5F7]"
        >
          <div
            className={cn(
              shellContainerClassName,
              "flex min-h-svh w-full flex-col items-center justify-between pt-[7.25rem] pb-6 sm:pt-[9.25rem] sm:pb-10 lg:pt-[11.25rem] lg:pb-14",
            )}
          >
            <FadeIn
              delay={0.05}
              duration={0.9}
              yOffset={28}
              className="flex w-full flex-col items-center text-center"
            >
              <h1 className="max-w-4xl font-display text-[clamp(2.5rem,1.02rem+6.6vw,4.5rem)] font-semibold leading-[1.07] tracking-[-0.28px] text-balance text-ink">
                Deadline Radar
              </h1>

              <p className="mt-4 max-w-xl text-[clamp(1.3125rem,0.9rem+2vw,1.75rem)] leading-[1.45] text-balance text-ink">
                Your deadlines, under control.
              </p>

              <Link
                href="/login"
                className="mt-10 inline-flex min-h-[44px] min-w-[44px] items-center justify-center rounded-full bg-primary px-[22px] py-[11px] text-[17px] leading-[1.47] tracking-[-0.374px] text-on-primary no-underline transition-opacity [@media(hover:hover)]:hover:opacity-90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-focus active:scale-95 motion-reduce:active:scale-100 sm:mt-12 lg:mt-14"
              >
                See your deadlines
              </Link>
            </FadeIn>

            <FadeIn
              delay={0.16}
              duration={0.95}
              yOffset={36}
              className="flex w-full flex-1 items-center justify-center"
            >
              <HeroNoteBoard />
            </FadeIn>
          </div>
        </section>

        <HowItWorks />
        <NotificationShowcase />
        <EditorialShowcase />
        <FocusStatement />
      </main>

      <LandingFooter />
    </div>
  );
}
