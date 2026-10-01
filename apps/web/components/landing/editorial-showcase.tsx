import { FadeIn } from "@/components/landing/fade-in";
import { shellContainerClassName } from "@/components/ui/shell-layout";
import { cn } from "@/lib/utils";

export function EditorialShowcase() {
  return (
    <section
      aria-labelledby="just-in-time-heading"
      className="relative w-full overflow-hidden py-24 sm:py-32 lg:py-40"
    >
      <div className={cn(shellContainerClassName, "flex flex-col items-center text-center")}>
        <FadeIn yOffset={32} className="flex max-w-3xl flex-col items-center">
          <span className="text-[12px] font-semibold tracking-[0.24em] text-ink-muted-64 uppercase sm:text-[13px]">
            JUST IN TIME
          </span>
          <h2
            id="just-in-time-heading"
            className="mt-4 font-display text-[clamp(2.25rem,1.4rem+4.5vw,3.75rem)] font-semibold tracking-[-0.035em] text-ink text-balance sm:mt-6"
          >
            Know before it’s due.
          </h2>
        </FadeIn>

        <FadeIn delay={0.12} yOffset={44} className="mt-14 mb-20 flex flex-col items-center sm:mt-18 sm:mb-28 lg:mt-24 lg:mb-32">
          <div className="mb-4 flex items-center justify-center gap-2.5 sm:mb-5">
            <span className="size-2 rounded-full bg-primary" />
            <span className="text-[13px] font-semibold tracking-[0.18em] text-ink-muted-64 uppercase sm:text-[14px]">
              TOMORROW · APR 2
            </span>
          </div>

          <div className="relative flex items-baseline justify-center leading-none tracking-tighter">
            <span className="font-display text-[clamp(4.75rem,2.5rem+11vw,11.75rem)] font-extralight tracking-[-0.05em] text-ink leading-[0.9]">
              11:59
            </span>
            <span className="ml-2 font-display text-[clamp(1.5rem,1rem+3vw,2.75rem)] font-light tracking-[-0.02em] text-ink-muted-48 opacity-70 sm:ml-3.5 lg:ml-4">
              PM
            </span>
          </div>

          <div className="mt-4 flex flex-col items-center gap-1 sm:mt-5 sm:gap-1.5">
            <span className="text-[clamp(1.5rem,1.2rem+2vw,2rem)] font-normal tracking-tight text-ink">
              Problem Set 4
            </span>
            <span className="text-base text-ink-muted-64 sm:text-lg">
              Calculus II
            </span>
          </div>
        </FadeIn>
      </div>
    </section>
  );
}
