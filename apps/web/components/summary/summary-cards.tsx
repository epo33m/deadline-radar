import Link from "next/link";
import { LayoutList } from "lucide-react";
import { getCourseCardPresentation } from "@/lib/courses/colors";
import type { WeekSummary } from "@/lib/summary/week";

const WEEK_SECTIONS: {
  id: keyof WeekSummary;
  title: string;
  token?: string;
  showCount?: boolean;
  subtitle?: string;
  dark?: boolean;
  fullWidth?: boolean;
}[] = [
  { id: "today", title: "Today", token: "system-blue", showCount: true },
  { id: "tomorrow", title: "Tomorrow", token: "system-indigo", showCount: true },
  { id: "thisWeek", title: "This week", token: "system-green", showCount: true },
  { id: "nextWeek", title: "Next week", token: "system-purple", showCount: true },
  { id: "thisMonth", title: "This month", token: "system-orange", showCount: true },
  { id: "missed", title: "Missed", token: "system-red", showCount: true },
];

type SummaryCardsProps = {
  counts: WeekSummary;
};

export function SummaryCards({ counts }: SummaryCardsProps) {
  return (
    <section
      aria-labelledby="latest-heading"
      className="relative left-1/2 w-screen -translate-x-1/2 bg-canvas py-6 sm:py-8"
    >
      <div className="mx-auto w-full max-w-6xl px-4 sm:px-6 lg:px-8">
        <h2
          id="latest-heading"
          className="mt-8 font-display text-[32px] font-semibold leading-[1.07] tracking-[-0.28px] text-ink sm:text-[36px] lg:text-[44px]"
        >
          Next up
        </h2>
        <div className="mt-14 mb-8 grid grid-cols-1 gap-7 sm:mt-16 sm:grid-cols-2 md:grid-cols-3">
          {WEEK_SECTIONS.map(
            ({ id, title, token, showCount, subtitle, dark, fullWidth }) => {
              const gradient = token
                ? getCourseCardPresentation(token)?.gradient?.replace(
                    "linear-gradient(120deg",
                    "linear-gradient(0deg",
                  )
                : undefined;
              return (
                <div
                  key={id}
                  className={`flex aspect-[4/3] flex-col items-center justify-center rounded-lg px-4 py-6 text-center ${
                    dark ? "bg-surface-black" : "bg-canvas-parchment"
                  } ${
                    fullWidth
                      ? "sm:aspect-[14/5] sm:col-span-2 md:aspect-[17/4] md:col-span-3"
                      : ""
                  }`}
                >
                  {showCount ? (
                    <p
                      className={`font-display text-[95px] leading-none font-semibold tracking-[-0.02em] ${
                        gradient
                          ? "bg-clip-text text-transparent"
                          : "text-ink"
                      }`}
                      style={
                        gradient ? { backgroundImage: gradient } : undefined
                      }
                    >
                      {counts[id]}
                    </p>
                  ) : null}
                  {subtitle ? (
                    <LayoutList
                      className="mb-1 size-14 text-body-on-dark"
                      aria-hidden="true"
                      strokeWidth={1.5}
                    />
                  ) : null}
                  <h3
                    className={`mt-3 text-[20px] font-medium ${
                      dark ? "text-body-on-dark" : "text-ink"
                    }`}
                  >
                    {title}
                  </h3>
                  {subtitle ? (
                    <Link
                      href="/tasks"
                      className="mt-1 text-[20px] font-normal text-primary underline-offset-4 hover:underline"
                    >
                      {subtitle}
                    </Link>
                  ) : null}
                </div>
              );
            },
          )}
        </div>
      </div>
    </section>
  );
}