/**
 * Cursor walking for server-rendered lists (#141).
 *
 * The web surfaces render on the server, so pagination is a URL concern
 * (`?pages=N`) and the accumulation happens here: walk `fetchPage` from the
 * first cursor until the API stops handing out `nextCursor`.
 *
 * Why the server owns the accumulation instead of the browser appending pages:
 * every mutation calls `revalidatePath`, so a client-held list is handed fresh
 * server props mid-session and has to re-sync or go stale. One server-side
 * source of truth is correct by construction. This mirrors what
 * `lib/calendar/load.ts` already does for the month view.
 */
import { LIST_MAX_PAGES } from "./limit";

export type PageResult<T> = {
  items: T[];
  nextCursor: string | null;
};

export type PagedResult<T> = PageResult<T> & {
  /** True when the API reported no further page — the list is the whole set. */
  complete: boolean;
  /**
   * True when `LIST_MAX_PAGES` was hit with a cursor still outstanding. The
   * caller must surface this: silent truncation is how a partial list passes as
   * complete.
   */
  truncated: boolean;
  pagesFetched: number;
  /**
   * The failure that stopped the walk, or `null` when it finished. Kept as a
   * value rather than logged here so this module stays pure and testable (and
   * so a caller can tell "the API said no" from "we could not ask").
   */
  error: unknown;
};

export type LoadPagedOptions = {
  /**
   * How many pages to walk. Defaults to `LIST_MAX_PAGES` and is clamped to it.
   *
   * A smaller value means "the user has not clicked load more yet", which is
   * NOT truncation — hence `truncated` below keys off the cap, not off this
   * number.
   */
  maxPages?: number;
};

export async function loadPaged<T extends { id: string }>(
  fetchPage: (cursor: string | null) => Promise<PageResult<T>>,
  options: LoadPagedOptions = {},
): Promise<PagedResult<T>> {
  const maxPages = Math.max(
    1,
    Math.min(options.maxPages ?? LIST_MAX_PAGES, LIST_MAX_PAGES),
  );
  // Only a walk that was allowed to go all the way can be *truncated*: a walk
  // stopped at the page count the user asked for still has a live "load more".
  const capped = maxPages >= LIST_MAX_PAGES;
  const items: T[] = [];
  const seen = new Set<string>();
  let cursor: string | null = null;
  let pagesFetched = 0;
  let error: unknown = null;

  for (let page = 0; page < maxPages; page += 1) {
    let result: PageResult<T>;
    try {
      result = await fetchPage(cursor);
    } catch (caught) {
      // Keep the pages already fetched: a failure on page 3 must not discard
      // pages 1-2. `complete` stays false so the caller reports the failure
      // instead of presenting a partial list as the whole set.
      error = caught;
      break;
    }

    pagesFetched += 1;
    for (const item of result.items) {
      // A row inserted between two requests can be returned twice across a
      // keyset boundary; React keys and "N loaded" counts both depend on ids
      // being unique.
      if (seen.has(item.id)) continue;
      seen.add(item.id);
      items.push(item);
    }

    cursor = result.nextCursor;
    if (cursor == null) {
      return {
        items,
        nextCursor: null,
        complete: true,
        truncated: false,
        pagesFetched,
        error: null,
      };
    }
  }

  return {
    items,
    nextCursor: cursor,
    complete: false,
    // Only a finished walk can be complete, and only a cap-limited walk with
    // pages left over is truncated.
    truncated: capped && cursor != null,
    pagesFetched,
    // Non-null only when a fetch threw. Rows already fetched are kept: a
    // failure on page 3 must not discard pages 1-2, and `complete: false` stops
    // a partial list from being presented as the whole set.
    error,
  };
}
