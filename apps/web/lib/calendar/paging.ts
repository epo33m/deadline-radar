/**
 * Month-fetch paging contract.
 *
 * The page size must stay at or below the API's `MAX_PAGE_LIMIT` in
 * `apps/api/src/lib/api/pagination.ts`. The API's `paginationQuerySchema`
 * rejects anything larger with a 400, and the month view has no error state for
 * that — it would render an empty calendar that reads as "nothing is due"
 * rather than "this request failed" (#74).
 *
 * `apps/web` has no path alias to `apps/api`, so the cap cannot be imported
 * here; `paging.test.ts` pins this constant to the cap instead, which fails
 * loudly if either side is changed independently.
 */

/** Rows requested per page. The API refuses anything above 100. */
export const CALENDAR_PAGE_LIMIT = 100;

/**
 * Safety cap on the fetch loop. Hitting it is SILENT TRUNCATION — a partial
 * month renders as complete — so the caller reports it to the log pipeline.
 */
export const CALENDAR_MAX_PAGES = 10;
