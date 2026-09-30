import { apiFetch } from "@/lib/api/server";
import type { ProgressSummary } from "@deadline-radar/domain";
import type { WeekSummary } from "@/lib/summary/week";

const SUMMARY_KEYS = [
  "today",
  "tomorrow",
  "thisWeek",
  "nextWeek",
  "thisMonth",
  "missed",
  "allTasks",
] as const;

export type SummaryLoadErrorKind =
  | "auth"
  | "forbidden"
  | "validation"
  | "unreachable"
  | "failed";

export type LoadSummaryResult =
  | {
      summary: WeekSummary;
      progress: ProgressSummary;
      error?: undefined;
      errorKind?: undefined;
    }
  | {
      summary?: undefined;
      progress?: undefined;
      error: string;
      errorKind: SummaryLoadErrorKind;
    };

export type SummaryFetcher = (path: string) => Promise<{
  data: unknown;
  response: { ok: boolean; status: number };
}>;

function isWeekSummary(value: unknown): value is WeekSummary {
  if (typeof value !== "object" || value === null) return false;
  const record = value as Record<string, unknown>;
  return SUMMARY_KEYS.every(
    (key) => typeof record[key] === "number" && Number.isFinite(record[key]),
  );
}

function isNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isProgressSummary(value: unknown): value is ProgressSummary {
  if (typeof value !== "object" || value === null) return false;
  const record = value as Record<string, unknown>;
  if (!isNumber(record.completed) || !isNumber(record.total)) return false;
  if (!isNumber(record.onTime) || !isNumber(record.onTimeTotal)) return false;
  if (!Array.isArray(record.courses)) return false;
  return record.courses.every((slice) => {
    if (typeof slice !== "object" || slice === null) return false;
    const entry = slice as Record<string, unknown>;
    return (
      typeof entry.name === "string" &&
      (typeof entry.color === "string" || entry.color === null) &&
      isNumber(entry.tasks)
    );
  });
}

function classifyStatus(status: number): {
  error: string;
  errorKind: SummaryLoadErrorKind;
} {
  if (status === 401) {
    return {
      error: "Your session has expired. Please sign in again.",
      errorKind: "auth",
    };
  }
  if (status === 403) {
    return {
      error: "You don't have permission to view this summary.",
      errorKind: "forbidden",
    };
  }
  if (status === 400) {
    return {
      error: "The summary could not be loaded. Please try again.",
      errorKind: "validation",
    };
  }
  if (status === 429) {
    return {
      error: "Too many requests. Please wait a moment and try again.",
      errorKind: "failed",
    };
  }
  return {
    error: "Could not load summary. Please try again later.",
    errorKind: "failed",
  };
}

/**
 * Injectable `fetchPage` keeps this unit-testable without `next/headers`.
 *
 * Error classification matters: mapping every failure to
 * "Ensure the API is running" misreported 401/403/400/500 as the API being
 * down (same incident class as the Calendar `limit=200` 400). Only transport
 * failures keep that wording.
 */
export async function loadSummary(
  fetchPage: SummaryFetcher = apiFetch,
): Promise<LoadSummaryResult> {
  let data: unknown;
  let response: { ok: boolean; status: number };
  try {
    const result = await fetchPage("/api/v1/summary");
    data = result.data;
    response = result.response;
  } catch {
    return {
      error:
        "Could not reach the summary service. Check your connection and ensure the API is running.",
      errorKind: "unreachable",
    };
  }

  if (!response.ok) {
    return classifyStatus(response.status);
  }

  const body = (data ?? {}) as {
    summary?: unknown;
    progress?: unknown;
    error?: unknown;
  };
  if (typeof body.error === "string" && body.error.length > 0) {
    return { error: body.error, errorKind: "failed" };
  }
  if (!isWeekSummary(body.summary) || !isProgressSummary(body.progress)) {
    return {
      error: "Could not load summary. Please try again later.",
      errorKind: "failed",
    };
  }
  return { summary: body.summary, progress: body.progress };
}
