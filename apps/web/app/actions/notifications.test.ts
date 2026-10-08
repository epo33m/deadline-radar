/**
 * #141: `listInAppNotifications` used to request page 1 with no `limit`, so a
 * user with more than 50 reminders hit a silent ceiling. These cases pin the two
 * things that must not regress:
 *
 *  - the request actually carries `limit` / `cursor`;
 *  - `complete` tracks the *cursor running out*, never the page count asked
 *    for, because `complete` is what makes the unread badge exact.
 */
import { beforeEach, describe, expect, mock, test } from "bun:test";

type ApiJsonCall = { path: string; init?: RequestInit };

const apiJsonCalls: ApiJsonCall[] = [];
let pages: Array<Record<string, unknown>> = [];

function notification(id: string): Record<string, unknown> {
  return {
    id,
    taskId: "task-1",
    thresholdId: "th-1",
    channel: "in_app",
    status: "sent",
    retryCount: 0,
    sentAt: "2026-01-01T00:00:00.000Z",
    readAt: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    taskTitle: `Task ${id}`,
    daysBefore: 3,
    isLate: false,
  };
}

mock.module("next/cache", () => ({
  revalidatePath: () => undefined,
}));

mock.module("@/lib/api/server", () => ({
  // See idempotency.test.ts: keep the full export shape so mocked imports
  // elsewhere (`lib/calendar/load`, `lib/summary/load`) keep resolving.
  apiFetch: async () => {
    throw new Error("apiFetch is stubbed in notifications.test.ts");
  },
  apiJson: async (path: string, init: RequestInit = {}) => {
    apiJsonCalls.push({ path, init });
    // Serve pages in order; the last entry repeats once exhausted.
    const index = Math.min(apiJsonCalls.length - 1, pages.length - 1);
    return pages[index] ?? {};
  },
  clearLocalAuthCookies: async () => undefined,
}));

const { listInAppNotifications } = await import("./notifications");

describe("#141 — listInAppNotifications cursor paging", () => {
  beforeEach(() => {
    apiJsonCalls.length = 0;
    pages = [
      {
        notifications: [notification("n1"), notification("n2")],
        page: { nextCursor: "cursor-2", limit: 50 },
      },
      {
        notifications: [notification("n3")],
        page: { nextCursor: null, limit: 50 },
      },
    ];
  });

  test("requests an explicit limit rather than relying on the API default", async () => {
    await listInAppNotifications();

    expect(apiJsonCalls[0].path).toContain("limit=50");
  });

  test("one page leaves the list incomplete so the UI can offer more", async () => {
    const list = await listInAppNotifications();

    expect(list.items.map((i) => i.id)).toEqual(["n1", "n2"]);
    // The bug: reading `complete` from a page that still had a cursor behind it
    // would let the header badge align to a partial list.
    expect(list.complete).toBe(false);
    expect(list.nextCursor).toBe("cursor-2");
    expect(list.truncated).toBe(false);
  });

  test("walks the cursor when more pages are requested", async () => {
    const list = await listInAppNotifications({ pages: 2 });

    expect(apiJsonCalls).toHaveLength(2);
    expect(apiJsonCalls[0].path).not.toContain("cursor=");
    expect(apiJsonCalls[1].path).toContain("cursor=cursor-2");
    expect(list.items.map((i) => i.id)).toEqual(["n1", "n2", "n3"]);
    expect(list.complete).toBe(true);
    expect(list.nextCursor).toBeNull();
  });

  test("does not walk further than the requested page count", async () => {
    await listInAppNotifications({ pages: 1 });

    expect(apiJsonCalls).toHaveLength(1);
  });

  test("clamps a hostile page count to the cap", async () => {
    await listInAppNotifications({ pages: 100_000 });

    expect(apiJsonCalls.length).toBeLessThanOrEqual(10);
  });

  test("an API error yields no items and never claims completeness", async () => {
    // `complete: true` here would sync a wrong (zero) unread count into the
    // header badge from an empty list.
    pages = [{ error: { code: "INTERNAL", message: "boom" } }];

    const list = await listInAppNotifications();

    expect(list.items).toEqual([]);
    expect(list.complete).toBe(false);
  });

  test("an API error mid-walk keeps the pages already fetched", async () => {
    pages = [
      {
        notifications: [notification("n1")],
        page: { nextCursor: "cursor-2", limit: 50 },
      },
      { error: { code: "INTERNAL", message: "boom" } },
    ];

    const list = await listInAppNotifications({ pages: 3 });

    expect(list.items.map((i) => i.id)).toEqual(["n1"]);
    expect(list.complete).toBe(false);
  });
});
