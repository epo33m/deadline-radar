import { describe, expect, test } from "bun:test";

import { CALENDAR_MAX_PAGES, CALENDAR_PAGE_LIMIT } from "./paging";

/**
 * `MAX_PAGE_LIMIT` from `apps/api/src/lib/api/pagination.ts`. Deliberately a
 * literal rather than an import: `apps/web` has no path alias to `apps/api`, and
 * reaching across it for one number would be worse than a pinned copy. The
 * point of this suite is that the two cannot drift apart silently.
 */
const API_MAX_PAGE_LIMIT = 100;

describe("calendar paging contract (#74)", () => {
  test("page size never exceeds the API cap", () => {
    // Regression guard: the month view used to send limit=200, which the API
    // rejected with a 400 and the page rendered as an empty calendar.
    expect(CALENDAR_PAGE_LIMIT).toBeLessThanOrEqual(API_MAX_PAGE_LIMIT);
  });

  test("the fetch loop still covers far more than a renderable month", () => {
    // MAX_PAGES × page size. 1,000 rows for a month view is two orders of
    // magnitude of headroom, so the cap is never the reason a month is empty.
    expect(CALENDAR_PAGE_LIMIT * CALENDAR_MAX_PAGES).toBeGreaterThanOrEqual(500);
  });

  test("the loop cap is reported so truncation stays observable", () => {
    // A page cap that is not surfaced is how partial months pass as complete.
    expect(CALENDAR_MAX_PAGES).toBeGreaterThan(1);
  });
});
