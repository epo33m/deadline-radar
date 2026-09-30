import { describe, expect, test } from "bun:test";

import type { ProgressSummary } from "@deadline-radar/domain";

import { loadSummary, type SummaryFetcher } from "./load";

const VALID_SUMMARY = {
  today: 1,
  tomorrow: 2,
  thisWeek: 3,
  nextWeek: 4,
  thisMonth: 5,
  missed: 0,
  allTasks: 15,
} as const;

const VALID_PROGRESS: ProgressSummary = {
  completed: 3,
  total: 10,
  onTime: 2,
  onTimeTotal: 3,
  courses: [{ name: "Math", color: "#0088ff", tasks: 7 }],
};

function okFetcher(body: Record<string, unknown>): SummaryFetcher {
  return async () => ({
    data: body,
    response: { ok: true, status: 200 },
  });
}

function statusFetcher(status: number): SummaryFetcher {
  return async () => ({
    data: { error: { code: "ERR", message: "upstream" } },
    response: { ok: false, status },
  });
}

const LOAD_ERROR = {
  error: "Could not load summary. Please try again later.",
  errorKind: "failed",
} as const;

describe("loadSummary", () => {
  test("returns the summary object on success", async () => {
    const result = await loadSummary(
      okFetcher({ summary: VALID_SUMMARY, progress: VALID_PROGRESS }),
    );
    expect(result).toEqual({
      summary: VALID_SUMMARY,
      progress: VALID_PROGRESS,
    });
  });

  test("returns an error when the summary field is missing", async () => {
    const result = await loadSummary(okFetcher({}));
    expect(result).toEqual(LOAD_ERROR);
  });

  test("returns an error when the upstream body carries an error", async () => {
    const result = await loadSummary(
      okFetcher({ error: "Not found", summary: undefined }),
    );
    expect(result.errorKind).toBe("failed");
    expect(result.error).toBe("Not found");
  });

  test("rejects summaries where a key is not a finite number", async () => {
    const result = await loadSummary(
      okFetcher({
        summary: { ...VALID_SUMMARY, today: "a" },
        progress: VALID_PROGRESS,
      }),
    );
    expect(result).toEqual(LOAD_ERROR);
  });

  test("accepts summaries with extra fields gracefully", async () => {
    const result = await loadSummary(
      okFetcher({
        summary: { ...VALID_SUMMARY, future: 99 },
        progress: VALID_PROGRESS,
      }),
    );
    expect(result).toEqual({
      // @ts-expect-error — `future` is not a WeekSummary key by design
      summary: { ...VALID_SUMMARY, future: 99 },
      progress: VALID_PROGRESS,
    });
  });

  test("returns an error when the progress field is missing", async () => {
    const result = await loadSummary(
      okFetcher({ summary: VALID_SUMMARY }),
    );
    expect(result).toEqual(LOAD_ERROR);
  });

  test("returns an error when a progress course entry is malformed", async () => {
    const result = await loadSummary(
      okFetcher({
        summary: VALID_SUMMARY,
        progress: {
          ...VALID_PROGRESS,
          courses: [{ name: "Math", color: "#0088ff" }],
        },
      }),
    );
    expect(result).toEqual(LOAD_ERROR);
  });

  test("maps 401 to an auth error (not an API-down message)", async () => {
    const result = await loadSummary(statusFetcher(401));
    expect(result.errorKind).toBe("auth");
    expect(result.error).toContain("sign in");
    expect(result.error).not.toContain("Ensure the API is running");
  });

  test("maps 403 to a permission error", async () => {
    const result = await loadSummary(statusFetcher(403));
    expect(result.errorKind).toBe("forbidden");
    expect(result.error).toContain("permission");
  });

  test("maps 500 to a retryable failure without claiming the API is down", async () => {
    const result = await loadSummary(statusFetcher(500));
    expect(result).toEqual(LOAD_ERROR);
  });

  test("maps transport throws to unreachable (the only API-down case)", async () => {
    const result = await loadSummary(async () => {
      throw new Error("fetch failed");
    });
    expect(result.errorKind).toBe("unreachable");
    expect(result.error?.toLowerCase()).toContain("ensure the api is running");
  });
});
