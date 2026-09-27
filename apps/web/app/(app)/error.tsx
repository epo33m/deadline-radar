"use client";

import { useEffect } from "react";

/**
 * Segment error fallback for authenticated pages (W6). Catches render/data
 * failures below the layout (which already resolved the session) and offers
 * a retry instead of a blank page. The digest correlates with server logs.
 */
export default function AppError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[web] app segment error", error.digest ?? "", error);
  }, [error]);

  return (
    <section className="space-y-2" aria-label="Page failed to load">
      <h1 className="font-display text-[32px] font-semibold leading-[1.07] tracking-[-0.28px] text-ink">
        Could not load this page
      </h1>
      <p className="text-sm text-ink-muted-80">
        Something went wrong while loading.
        {error.digest ? ` ref: ${error.digest}` : null}
      </p>
      <button
        type="button"
        onClick={() => reset()}
        className="mt-2 inline-flex items-center rounded-full bg-ink px-4 py-2 font-sans text-sm text-on-dark no-underline"
      >
        Try again
      </button>
    </section>
  );
}
