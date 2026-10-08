/**
 * Href builder for the list paging links (#141).
 *
 * The paging state lives in `?pages=`, so the "load more" link has to carry the
 * surface's other query state with it — the course detail keeps `view`
 * (upcoming/overdue/done) in the URL, and losing it on paging would silently
 * reset the user's filter.
 */

export type QueryValue = string | number | boolean | null | undefined;

/**
 * Same pathname, `pages` set to `pageCount`, every other param preserved.
 * Passing `pageCount <= 1` drops `pages` entirely so the base URL stays clean.
 */
export function withPageCount(
  pathname: string,
  params: Record<string, QueryValue>,
  pageCount: number,
): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value == null || value === "") continue;
    search.set(key, String(value));
  }
  if (pageCount > 1) search.set("pages", String(pageCount));
  const query = search.toString();
  return query.length > 0 ? `${pathname}?${query}` : pathname;
}
