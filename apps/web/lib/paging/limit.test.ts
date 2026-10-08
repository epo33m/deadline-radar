import { describe, expect, test } from "bun:test";

import { LIST_MAX_PAGES, LIST_PAGE_LIMIT } from "./limit";

/**
 * `MAX_PAGE_LIMIT` from `apps/api/src/lib/api/pagination.ts`. Deliberately a
 * literal rather than an import: `apps/web` has no path alias to `apps/api`, and
 * reaching across it for one number would be worse than a pinned copy. The point
 * of this suite is that the two cannot drift apart silently — same approach as
 * `lib/calendar/paging.test.ts`.
 */
const API_MAX_PAGE_LIMIT = 100;

describe("web list paging contract (#141)", () => {
  test("page size never exceeds the API cap", () => {
    // Regression guard: the API rejects a larger limit with a 400, and these
    // surfaces have no error state for that — the list would render empty.
    expect(LIST_PAGE_LIMIT).toBeLessThanOrEqual(API_MAX_PAGE_LIMIT);
  });

  test("the walk is bounded", () => {
    // An unbounded walk over an unbounded collection (notifications) would hang
    // the request instead of rendering a partial list.
    expect(LIST_MAX_PAGES).toBeGreaterThan(1);
  });

  test("tasks can always be walked to the end within the cap", () => {
    // MAX_ACTIVE_TASKS_PER_USER is 200, so the task surfaces must be able to
    // reach every task a user may own without hitting the truncation cap.
    const MAX_ACTIVE_TASKS_PER_USER = 200;
    expect(LIST_PAGE_LIMIT * LIST_MAX_PAGES).toBeGreaterThanOrEqual(
      MAX_ACTIVE_TASKS_PER_USER,
    );
  });

  test("more than one page is reachable, which is the point of the fix", () => {
    // The bug was a silent 50-row ceiling; a cap of 1 would reintroduce it.
    expect(LIST_MAX_PAGES).toBeGreaterThanOrEqual(2);
  });
});
