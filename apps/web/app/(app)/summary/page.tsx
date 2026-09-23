import { ProgressSection } from "@/components/summary/progress-section";
import { SummaryRefresh } from "@/components/summary/summary-refresh";
import { SummaryCards } from "@/components/summary/summary-cards";
import { requireSession } from "@/lib/api/session";
import { getSummaryGreeting, getSummaryTagline } from "@/lib/summary/greeting";
import { loadSummary } from "@/lib/summary/load";

export default async function SummaryPage() {
  // Overlap the session RTT with the data fetch; the redirect still wins
  // for unauthenticated viewers because it is awaited before render.
  const sessionPromise = requireSession();

  const result = await loadSummary();

  await sessionPromise;
  if (result.summary === undefined) {
    return (
      <section className="space-y-9 sm:space-y-12">
        <div className="min-w-0 mt-8 text-center sm:mt-12">
          <h1 className="font-display text-[40px] font-semibold leading-[1.07] tracking-[-0.28px] text-ink sm:text-[42px] lg:text-[50px]">
            {getSummaryGreeting()}
          </h1>
          <p className="mx-auto mt-5 max-w-2xl text-[19px] leading-[1.47] tracking-[-0.374px] text-ink sm:text-[21px]">
            {getSummaryTagline()}
          </p>
        </div>
        <p className="text-sm text-destructive" role="alert">
          {result.error ?? "Could not load summary. Ensure the API is running."}
        </p>
      </section>
    );
  }

  return (
    <section className="space-y-6 sm:space-y-8">
      <SummaryRefresh />
      <div className="min-w-0 mt-8 text-center sm:mt-12">
        <h1 className="font-display text-[42px] font-semibold leading-[1.07] tracking-[-0.28px] text-ink sm:text-[46px] lg:text-[58px]">
          {getSummaryGreeting()}
        </h1>
        <p className="mx-auto mt-5 max-w-2xl text-[19px] leading-[1.47] tracking-[-0.374px] text-ink sm:text-[21px]">
          {getSummaryTagline()}
        </p>
      </div>

      <SummaryCards counts={result.summary} />
      <ProgressSection progress={result.progress} />
    </section>
  );
}