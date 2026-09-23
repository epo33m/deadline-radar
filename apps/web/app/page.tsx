import Link from "next/link";

// SEC-002: strict nonce CSP requires dynamic rendering so Next can attach
// the per-request `x-nonce` to its inline scripts (static prerender has none).
export const dynamic = "force-dynamic";

export default function HomePage() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-canvas-parchment px-6 text-center font-sans text-ink sm:px-8">
      <div className="flex max-w-lg flex-col items-center">
        <h1 className="font-display text-[36px] font-semibold leading-[1.07] tracking-[-0.28px] text-ink sm:text-[44px] lg:text-[60px]">
          <span className="whitespace-nowrap">Stay ahead of every</span>
          <br />
          <span className="bg-[linear-gradient(90deg,var(--destructive)_0%,var(--destructive)_72%,var(--warning)_100%)] bg-clip-text text-transparent">
            deadline
          </span>
        </h1>

        <p className="mt-3 text-[21px] font-normal leading-[1.19] tracking-[0.231px] text-ink-muted-48">
          Keep track of coursework
          <br />
          and know what&apos;s due next.
        </p>

        <Link
          href="/login"
          className="mt-[17px] inline-flex items-center justify-center rounded-full bg-ink px-[22px] py-[11px] font-sans text-[17px] font-normal leading-[1.47] tracking-[-0.374px] text-on-dark no-underline transition-transform hover:bg-ink-muted-80 active:scale-95 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink-muted-80"
        >
          Sign in
        </Link>

        <p className="mt-6 text-sm leading-[1.43] tracking-[-0.224px] text-ink-muted-48">
          New here?{" "}
          <Link
            href="/register"
            className="text-primary hover:underline focus-visible:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-focus"
          >
            Create an account
          </Link>{" "}
          to get started.
        </p>
      </div>
    </main>
  );
}
