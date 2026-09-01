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
          App shell is ready
        </h1>
        <p className="text-lg text-ink-muted-48">
          Next.js, Tailwind, and design tokens are wired. Auth and dashboard
          routes are placeholders for later MVP tickets.
        </p>
        <div className="flex flex-wrap gap-3">
          <Button
            nativeButton={false}
            render={<Link href="/login" />}
            className="rounded-full px-[22px] py-[11px] text-[17px]"
          >
            Login
          </Button>
          <Button
            variant="outline"
            nativeButton={false}
            render={<Link href="/dashboard" />}
            className="rounded-full px-[22px] py-[11px] text-[17px]"
          >
            Dashboard
          </Button>
        </div>
      </div>
    </main>
  );
}
