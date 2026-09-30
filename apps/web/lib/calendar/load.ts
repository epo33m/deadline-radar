import { monthVisibleRange } from "@/lib/calendar/month";
import { CALENDAR_MAX_PAGES, CALENDAR_PAGE_LIMIT } from "@/lib/calendar/paging";
import type { TaskStatus } from "@/lib/validation/task";

export type CalendarApiTask = {
  id: string;
  title: string;
  deadline: string | Date;
  status: TaskStatus;
  courseName: string | null;
  courseColor: string | null;
};

export type CalendarLoadErrorKind =
  | "auth"
  | "forbidden"
  | "validation"
  | "unreachable"
  | "failed";

export type LoadCalendarResult =
  | { tasks: CalendarApiTask[]; error?: undefined; errorKind?: undefined }
  | { tasks?: undefined; error: string; errorKind: CalendarLoadErrorKind };

export type CalendarPageFetcher = (path: string) => Promise<{
  data: unknown;
  response: { ok: boolean; status: number };
}>;

function classifyStatus(status: number): {
  error: string;
  errorKind: CalendarLoadErrorKind;
} {
  if (status === 401) {
    return {
      error: "Your session has expired. Please sign in again.",
      errorKind: "auth",
    };
  }
  if (status === 403) {
    return {
      error: "You don't have permission to view these deadlines.",
      errorKind: "forbidden",
    };
  }
  if (status === 400) {
    return {
      error: "The requested month could not be loaded. Please try again.",
      errorKind: "validation",
    };
  }
  if (status === 429) {
    return {
      error: "Too many requests. Please wait a moment and try again.",
      errorKind: "failed",
    };
  }
  if (status >= 500) {
    return {
      error: "Could not load calendar deadlines. Please try again later.",
      errorKind: "failed",
    };
  }
  return {
    error: "Could not load calendar deadlines. Please try again later.",
    errorKind: "failed",
  };
}

function isTaskArray(value: unknown): value is CalendarApiTask[] {
  return Array.isArray(value);
}

/**
 * Month-scoped task fetch: visible range only, cursors followed to exhaustion.
 * Injectable `fetchPage` keeps this unit-testable without `next/headers`.
 *
 * Error classification matters: the previous page mapped every failure to
 * "Ensure the API is running", which misreported 401/403/400/500 as the API
 * being down. Only transport failures keep that wording.
 */
export async function loadCalendarMonth(
  fetchPage: CalendarPageFetcher,
  timeZone: string,
  year: number,
  month: number,
): Promise<LoadCalendarResult> {
  const { dueFrom, dueTo } = monthVisibleRange(year, month, timeZone);
  const tasks: CalendarApiTask[] = [];
  let cursor: string | null = null;

  for (let page = 0; page < CALENDAR_MAX_PAGES; page += 1) {
    // The API caps `limit` at 100 and rejects anything above it. Both numbers
    // live in `@/lib/calendar/paging`, which `paging.test.ts` pins to the API
    // contract — see #74.
    const qs = new URLSearchParams({
      limit: String(CALENDAR_PAGE_LIMIT),
      dueFrom,
      dueTo,
    });
    if (cursor) qs.set("cursor", cursor);

    let data: unknown;
    let response: { ok: boolean; status: number };
    try {
      const result = await fetchPage(`/api/v1/tasks?${qs.toString()}`);
      data = result.data;
      response = result.response;
    } catch {
      return {
        error:
          "Could not reach the calendar service. Check your connection and ensure the API is running.",
        errorKind: "unreachable",
      };
    }

    if (!response.ok) {
      return classifyStatus(response.status);
    }

    const body = (data ?? {}) as {
      tasks?: unknown;
      error?: unknown;
      page?: { nextCursor?: string | null };
    };
    if (typeof body.error === "string" && body.error.length > 0) {
      return { error: body.error, errorKind: "failed" };
    }
    if (!isTaskArray(body.tasks)) {
      return {
        error: "Could not load calendar deadlines. Please try again later.",
        errorKind: "failed",
      };
    }
    tasks.push(...body.tasks);
    cursor = body.page?.nextCursor ?? null;
    if (!cursor) return { tasks };
  }

  if (cursor) {
    console.warn(
      "[calendar] month fetch hit page cap",
      JSON.stringify({
        year,
        month,
        maxPages: CALENDAR_MAX_PAGES,
        pageSize: CALENDAR_PAGE_LIMIT,
        tasksCollected: tasks.length,
      }),
    );
  }
  return { tasks };
}
