import Link from "next/link";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * Paging control for server-rendered lists (#141).
 *
 * The list surfaces used to fetch page 1 only, so a user with more than 50 rows
 * hit a silent ceiling. Paging state lives in `?pages=N` and the accumulated
 * rows are rendered server-side, so this is a link — no client state, no fetch
 * on click, and the back button works.
 *
 * The count is always shown, not just when more pages exist: a list that stops
 * at 50 without saying so is the bug this control exists to remove.
 */
export function ListPager({
  loadedCount,
  nextPageHref,
  truncated = false,
  note,
  noun,
  nounPlural,
  className,
}: {
  /** Rows currently rendered. */
  loadedCount: number;
  /** URL for the next page; omit when the list is exhausted. */
  nextPageHref?: string;
  /** The walk hit `LIST_MAX_PAGES` with rows still outstanding. */
  truncated?: boolean;
  /** Overrides the truncation wording, e.g. when a fetch failed mid-walk. */
  note?: string;
  /** Singular row label, e.g. "task". */
  noun: string;
  /** Plural row label, e.g. "tasks". */
  nounPlural: string;
  className?: string;
}) {
  const label =
    loadedCount === 1 ? `Showing 1 ${noun}` : `Showing ${loadedCount} ${nounPlural}`;
  const footnote = note ?? (truncated ? `Older ${nounPlural} aren't shown here.` : null);

  return (
    <div
      className={cn(
        "flex flex-col items-center gap-2 pt-2 text-center sm:flex-row sm:justify-between sm:gap-4 sm:text-left",
        className,
      )}
    >
      <p className="text-[13px] text-ink-muted-64 sm:text-sm">{label}</p>

      {nextPageHref ? (
        <Button
          variant="outline"
          nativeButton={false}
          render={<Link href={nextPageHref} scroll={false} />}
          className="min-h-9 rounded-full px-4 text-[13px] font-medium sm:text-sm"
        >
          Load more
        </Button>
      ) : null}

      {footnote ? (
        <p className="w-full text-[13px] text-ink-muted-64 sm:w-auto">{footnote}</p>
      ) : null}
    </div>
  );
}
