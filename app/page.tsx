import Link from "next/link";

import { Button } from "@/components/ui/button";

export default function HomePage() {
  return (
    <main className="min-h-screen bg-canvas-parchment text-ink">
      <div className="mx-auto flex min-h-screen max-w-2xl flex-col justify-center gap-6 px-6 py-16">
        <p className="font-display text-sm font-semibold tracking-wide text-primary">
          Deadline Radar
        </p>
        <h1 className="font-display text-4xl font-semibold tracking-tight text-ink">
          Stay ahead of every deadline
        </h1>
        <p className="text-lg text-ink-muted-48">
          Track coursework, set reminder thresholds, and see what is due next.
        </p>
        <div className="flex flex-wrap gap-3">
          <Button
            nativeButton={false}
            render={<Link href="/login" />}
            className="rounded-full px-[22px] py-[11px] text-[17px]"
          >
            Sign in
          </Button>
          <Button
            variant="outline"
            nativeButton={false}
            render={<Link href="/register" />}
            className="rounded-full px-[22px] py-[11px] text-[17px]"
          >
            Create account
          </Button>
        </div>
      </div>
    </main>
  );
}
