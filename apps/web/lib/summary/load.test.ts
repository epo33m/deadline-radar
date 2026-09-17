import { describe, expect, test } from "bun:test";

import type { ProgressSummary } from "@deadline-radar/domain";

import { loadSummary } from "./load";

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

function fakeApiJson(body: Record<string, unknown>) {
  return async <T = unknown>(): Promise<T> => body as T;
}

const LOAD_ERROR = {
  error: "Could not load summary. Ensure the API is running.",
};

describe("loadSummary", () => {
  test("returns the summary object on success", async () => {
    const result = await loadSummary(
      fakeApiJson({ summary: VALID_SUMMARY, progress: VALID_PROGRESS }),
    );
    expect(result).toEqual({
      summary: VALID_SUMMARY,
      progress: VALID_PROGRESS,
    });
  });

  test("returns an error when the summary field is missing", async () => {
    const result = await loadSummary(fakeApiJson({}));
    expect(result).toEqual(LOAD_ERROR);
  });

  test("returns an error when the upstream request failed", async () => {
    const result = await loadSummary(
      fakeApiJson({ error: "Not found", summary: undefined }),
    );
    expect(result).toEqual(LOAD_ERROR);
  });

  test("rejects summaries where a key is not a finite number", async () => {
    const result = await loadSummary(
      fakeApiJson({
        summary: { ...VALID_SUMMARY, today: "a" },
        progress: VALID_PROGRESS,
      }),
    );
    expect(result).toEqual(LOAD_ERROR);
  });

  test("accepts summaries with extra fields gracefully", async () => {
    const result = await loadSummary(
      fakeApiJson({
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
    const result = await loadSummary(fakeApiJson({ summary: VALID_SUMMARY }));
    expect(result).toEqual(LOAD_ERROR);
  });

  test("returns an error when a progress course entry is malformed", async () => {
    const result = await loadSummary(
      fakeApiJson({
        summary: VALID_SUMMARY,
        progress: {
          ...VALID_PROGRESS,
          courses: [{ name: "Math", color: "#0088ff" }],
        },
      }),
    );
    expect(result).toEqual(LOAD_ERROR);
  });
});