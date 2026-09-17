import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { LearnSecondaryNav } from "@/components/learn/learn-secondary-nav";
import { Button } from "@/components/ui/button";

export function LearnDetail() {
  return (
    <section className="space-y-6 sm:space-y-8">
      <LearnSecondaryNav />

      <div className="min-w-0 mt-8 text-center sm:mt-12">
        <h2 className="font-display text-[36px] font-semibold leading-[1.07] tracking-[-0.28px] text-ink sm:text-[40px] lg:text-[48px]">
          Get Started
        </h2>
        <p className="mx-auto mt-5 max-w-2xl text-[19px] leading-[1.47] tracking-[-0.374px] text-ink sm:text-[21px]">
          Learn how Deadline Radar helps you organize your courses, manage the tasks that come with them, and keep track of important deadlines. Explore how courses, tasks, and the calendar work together to give you a clearer view of what you need to do and when it needs to be completed.
        </p>

        <h3 className="mb-17 mt-28 font-display text-[28px] font-semibold leading-[1.1] tracking-[-0.28px] text-ink sm:text-[32px]">
          How it works
        </h3>
      </div>

      <div className="relative left-1/2 w-screen -translate-x-1/2 space-y-3">
        <div className="bg-muted py-41">
          <div className="flex items-center gap-22 px-8">
            <div className="flex flex-1 justify-end">
              <h4 className="shrink-0 bg-clip-text bg-linear-0 text-[250px] leading-none font-semibold text-transparent from-[#66B8FF] via-[#33A0FF] to-[#0088FF]">01</h4>
            </div>
            <div className="flex flex-1 justify-start">
              <div className="shrink-0 max-w-md">
                <p className="text-2xl text-ink-muted-80"><span className="mb-5 block text-4xl font-semibold text-ink">Add a course</span>Start by adding the courses you're currently taking. Each course gives your tasks and deadlines a place to belong.</p>
                <Link href="/courses" className="mt-5 inline-flex items-center gap-1.5 text-2xl text-primary underline-offset-4 hover:underline hover:text-primary/80">Explore course<ChevronRight className="size-5" aria-hidden="true" /></Link>
              </div>
            </div>
          </div>
        </div>
        <div className="bg-muted py-41">
          <div className="flex items-center gap-22 px-8">
            <div className="flex flex-1 justify-end">
              <div className="shrink-0 max-w-md text-right">
                <p className="text-2xl text-ink-muted-80"><span className="mb-5 block text-4xl font-semibold text-ink">Add your tasks</span>Add assignments, exams, projects, and other work that needs to be completed. Give each task a deadline so you know when it's due.</p>
                <Link href="/tasks" className="mt-5 inline-flex items-center gap-1.5 text-2xl text-primary underline-offset-4 hover:underline hover:text-primary/80">Explore task<ChevronRight className="size-5" aria-hidden="true" /></Link>
              </div>
            </div>
            <div className="flex flex-1 justify-start">
              <h4 className="shrink-0 bg-clip-text bg-linear-0 text-[250px] leading-none font-semibold text-transparent from-[#83DE9A] via-[#5AD479] to-[#34C759]">02</h4>
            </div>
          </div>
        </div>
        <div className="bg-muted py-41">
          <div className="flex items-center gap-22 px-8">
            <div className="flex flex-1 justify-end">
              <h4 className="shrink-0 bg-clip-text bg-linear-0 text-[250px] leading-none font-semibold text-transparent from-[#FFC38E] via-[#FFA85B] to-[#FF8D28]">03</h4>
            </div>
            <div className="flex flex-1 justify-start">
              <div className="shrink-0 max-w-md">
                <p className="text-2xl text-ink-muted-80"><span className="mb-5 block text-4xl font-semibold text-ink">Track your deadlines</span>Use your tasks and calendar to see what's coming up, understand what needs your attention, and plan your time ahead.</p>
                <Link href="/calendar" className="mt-5 inline-flex items-center gap-1.5 text-2xl text-primary underline-offset-4 hover:underline hover:text-primary/80">Explore calendar<ChevronRight className="size-5" aria-hidden="true" /></Link>
              </div>
            </div>
          </div>
        </div>
        <div className="pt-41 bg-black pb-24">
          <div className="flex flex-col items-center gap-8 px-8 text-center">
            <div>
              <h4 className="text-4xl font-semibold text-white">You're all set.</h4>
              <p className="mt-5 max-w-md text-2xl text-white/80">Now you know how courses, tasks, and deadlines work together.</p>
            </div>
            <Button nativeButton={false} render={<Link href="/summary" />} size="lg" className="px-6 text-base" style={{ backgroundColor: "#fff", color: "#000" }}>Go to Summary<ChevronRight /></Button>
          </div>
        </div>
      </div>
    </section>
  );
}
