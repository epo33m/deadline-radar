/**
 * UI list paging contract (#141).
 *
 * The API paginates every success collection with keyset cursors and a default
 * limit of 50. The web surfaces (tasks, course tasks, notifications) used to
 * request page 1 only, so anyone past 50 rows hit a silent ceiling.
 *
 * The page size must stay at or below the API's `MAX_PAGE_LIMIT` in
 * `apps/api/src/lib/api/pagination.ts`. The API rejects anything larger with a
 * 400, and these pages have no error state for that — they would render as an
 * empty list. `apps/web` has no path alias to `apps/api`, so the cap cannot be
 * imported here; `limit.test.ts` pins this constant to it instead, which fails
 * loudly if either side changes independently (same approach as
 * `lib/calendar/paging.ts`).
 */

/** Rows requested per page. The API refuses anything above 100. */
export const LIST_PAGE_LIMIT = 50;

/**
 * Safety cap on the cursor walk.
 *
 * Tasks can never reach it: `MAX_ACTIVE_TASKS_PER_USER` is 200, so four pages
 * cover every task a user may own. Notifications are unbounded, so this cap is
 * what keeps a cursor walk finite — and because a cap that is not surfaced is
 * how a truncated list passes as complete, callers must render `truncated`.
 */
export const LIST_MAX_PAGES = 10;
