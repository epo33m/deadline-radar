import { ProgressSection } from "@/components/summary/progress-section";
import { SummaryRefresh } from "@/components/summary/summary-refresh";
import { SummaryCards } from "@/components/summary/summary-cards";
import { requireBootstrap } from "@/lib/api/bootstrap";
import { getSummaryGreeting, getSummaryTagline } from "@/lib/summary/greeting";

export default async function SummaryPage() {
  // Bootstrap (React-cached with the layout) is the only request this page
  // needs: summary + progress ride along with user + courses.
  const { summary, progress } = await requireBootstrap();

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

      <SummaryCards counts={summary} />
      <ProgressSection progress={progress} />
    </section>
  );
}
