import Link from "next/link";

import { FadeIn } from "@/components/landing/fade-in";
import { shellContainerClassName } from "@/components/ui/shell-layout";
import { cn } from "@/lib/utils";

export function FocusStatement() {
  return (
    <section aria-labelledby="focus-statement" className="w-full">
      <Link
        href="/login"
        aria-label="Sign in to Deadline Radar"
        className="group block w-full cursor-pointer no-underline focus-visible:outline-none"
      >
        <div
          style={{
            background:
              "linear-gradient(110deg, #F7F5EF 0%, #F5F4F0 45%, #F1F3F1 100%)",
          }}
          className="relative left-1/2 w-screen -translate-x-1/2 pt-24 pb-24 transition-opacity duration-300 group-hover:opacity-95 sm:pt-36 sm:pb-36 lg:pt-44 lg:pb-44"
        >
          <FadeIn
            yOffset={36}
            className={cn(
              shellContainerClassName,
              "flex flex-col items-center text-center",
            )}
          >
            <p className="text-[13px] font-semibold uppercase tracking-wider text-ink sm:text-[15px] lg:text-[16px]">
              LESS TO REMEMBER
            </p>
            <h2
              id="focus-statement"
              className="mt-2.5 max-w-4xl font-display text-[clamp(2.75rem,2rem+3.5vw,4.25rem)] font-semibold leading-[1.08] tracking-[-0.28px] text-balance text-ink"
            >
              More time to focus.
            </h2>
          </FadeIn>
        </div>
      </Link>
    </section>
  );
}
