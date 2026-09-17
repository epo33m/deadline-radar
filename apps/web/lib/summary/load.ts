import { apiJson } from "@/lib/api/server";
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

export type LoadSummaryResult =
  | { summary: WeekSummary; progress: ProgressSummary; error?: undefined }
  | { summary?: undefined; progress?: undefined; error: string };

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

export async function loadSummary(
  fetchJson: typeof apiJson = apiJson,
): Promise<LoadSummaryResult> {
  const result = await fetchJson<{
    summary?: WeekSummary;
    progress?: ProgressSummary;
  }>("/api/v1/summary");
  if (
    result.error ||
    !isWeekSummary(result.summary) ||
    !isProgressSummary(result.progress)
  ) {
    return { error: "Could not load summary. Ensure the API is running." };
  }
  return { summary: result.summary, progress: result.progress };
}