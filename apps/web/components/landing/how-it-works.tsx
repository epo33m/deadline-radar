import { FadeIn } from "@/components/landing/fade-in";
import { shellContainerClassName } from "@/components/ui/shell-layout";
import { cn } from "@/lib/utils";

const WORKFLOW_STEPS = [
  {
    number: "01",
    title: "Courses",
    items: ["Biology", "Calculus II", "Physics"],
  },
  {
    number: "02",
    title: "Tasks",
    items: ["Problem Set 4", "Midterm Exam", "Research Paper"],
  },
  {
    number: "03",
    title: "Deadlines",
    items: ["Tomorrow", "Apr 2", "Apr 5"],
  },
] as const;

export function HowItWorks() {
  return (
    <section id="how-it-works" aria-labelledby="get-started-heading" className="w-full">
      <div className="relative left-1/2 w-screen -translate-x-1/2 bg-white py-24 md:py-32 lg:py-36">
        <div className={cn(shellContainerClassName, "max-w-[1280px]")}>
          <FadeIn yOffset={32} className="mx-auto mb-14 flex max-w-3xl flex-col items-center text-center sm:mb-16 lg:mb-20">
            <span className="mb-4 text-[13px] font-semibold uppercase tracking-[0.2em] text-[#86868B] sm:text-[14px]">
              GET STARTED
            </span>
            <h2
              id="get-started-heading"
              className="font-display text-[clamp(2.25rem,1.4rem+4.5vw,4rem)] font-semibold tracking-[-0.035em] text-[#1D1D1F] leading-[1.06]"
            >
              Put everything in place.
            </h2>
          </FadeIn>

          <FadeIn delay={0.12} yOffset={44} className="grid grid-cols-1 gap-14 md:grid-cols-3 md:gap-10 lg:gap-20 xl:gap-28">
            {WORKFLOW_STEPS.map((step) => (
              <div key={step.number} className="flex flex-col items-center">
                <span className="mb-4 font-display text-[clamp(4.5rem,3rem+8vw,6.5rem)] font-extralight tracking-[-0.04em] text-[#AEAEB2]/50 leading-none">
                  {step.number}
                </span>
                <h3 className="mb-6 text-[22px] font-semibold tracking-[-0.02em] text-[#1D1D1F] sm:text-[25px] lg:text-[27px]">
                  {step.title}
                </h3>
                <ul className="inline-flex flex-col items-start gap-2 text-left sm:gap-2.5">
                  {step.items.map((item, idx) => (
                    <li
                      key={item}
                      className={cn(
                        "text-[16px] leading-relaxed sm:text-[17.5px] lg:text-[18.5px] tracking-[-0.01em]",
                        idx === 0
                          ? "font-medium text-[#1D1D1F]"
                          : "font-normal text-[#86868B]",
                      )}
                    >
                      {item}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </FadeIn>
        </div>
      </div>
    </section>
  );
}
