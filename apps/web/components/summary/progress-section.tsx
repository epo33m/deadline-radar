import {
  CourseDistributionBars,
  CourseDistributionCaption,
  toDistributionSlices,
} from "@/components/summary/course-distribution";
import { ProgressBar } from "@/components/summary/progress-bar";
import type { ProgressSummary } from "@deadline-radar/domain";

type ProgressSectionProps = {
  progress: ProgressSummary;
};

export function ProgressSection({ progress }: ProgressSectionProps) {
  const { completed, total, onTime, onTimeTotal, courses } = progress;
  const onTimePercent =
    onTimeTotal > 0 ? Math.round((onTime / onTimeTotal) * 100) : null;
  const slices = toDistributionSlices(courses);
  const activeTotal = slices.reduce((sum, slice) => sum + slice.tasks, 0);

  const cards: {
    title: string;
    stat?: string;
    body?: string;
    distribution?: boolean;
  }[] = [
    {
      title: "Punctual",
      stat: onTimePercent === null ? "—" : `${onTimePercent}%`,
      body:
        onTimePercent === null
          ? "No completed tasks yet."
          : "of tasks finished on time.",
    },
    { title: "Workload", distribution: true },
  ];
  return (
    <section
      aria-labelledby="progress-heading"
      className="relative left-1/2 w-screen -translate-x-1/2 bg-canvas-parchment py-6 sm:py-8"
    >
      <div className="mx-auto w-full max-w-6xl px-4 sm:px-6 lg:px-8">
        <h2
          id="progress-heading"
          className="mt-8 font-display text-[32px] font-semibold leading-[1.07] tracking-[-0.28px] text-ink sm:text-[36px] lg:text-[44px]"
        >
          Progress
        </h2>
        <div className="mt-14 mb-8 grid grid-cols-1 gap-7 sm:mt-16">
          <div className="relative flex aspect-[4/3] flex-col items-start justify-start rounded-lg bg-canvas px-6 py-6 text-left sm:aspect-[14/5] sm:px-8">
            <p className="text-[20px] font-semibold text-ink">
              Overall completion
            </p>
            <div className="mx-auto mt-14 w-full max-w-3xl">
              <ProgressBar value={completed} max={total} />
              <p className="mt-4 text-center text-[15px] font-semibold text-ink-muted-64">
                {completed} of {total} task{total === 1 ? "" : "s"} completed
              </p>
            </div>
          </div>
          <div className="grid grid-cols-1 gap-7 sm:grid-cols-2">
            {cards.map((card) => (
              <div
                key={card.title}
                className="rounded-lg bg-canvas px-6 py-8 text-left"
              >
                {card.distribution ? (
                  <div className="flex items-baseline justify-between gap-4">
                    <p className="text-[20px] font-semibold text-ink">{card.title}</p>
                    <CourseDistributionCaption
                      total={activeTotal}
                      courseCount={slices.length}
                    />
                  </div>
                ) : (
                  <p className="text-[20px] font-semibold text-ink">{card.title}</p>
                )}
                {card.stat ? (
                  <p className="mt-2 font-display text-[48px] leading-none font-semibold text-ink">
                    {card.stat}
                  </p>
                ) : null}
                {card.distribution ? (
                  <div className="mt-2 w-full">
                    <CourseDistributionBars slices={slices} />
                  </div>
                ) : null}
                {card.body ? (
                  <p className="mt-2 text-[15px] font-semibold text-ink-muted-64">{card.body}</p>
                ) : null}
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
