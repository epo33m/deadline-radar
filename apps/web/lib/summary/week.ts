import {
  summarizeDeadlineBuckets,
  THIS_WEEK_DAYS,
  NEXT_WEEK_DAYS,
  THIS_MONTH_DAYS,
  type WeekSummary,
} from "@deadline-radar/domain";

/**
 * Thin compatibility shim. The canonical bucket logic lives in
 * `@deadline-radar/domain` so the API and the web can never drift.
 * `SummaryTask` is structurally compatible with the domain's bucket input.
 */
export const summarizeWeekTasks = summarizeDeadlineBuckets;
export { THIS_WEEK_DAYS, NEXT_WEEK_DAYS, THIS_MONTH_DAYS };
export type { WeekSummary };