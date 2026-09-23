import { eq, sql } from "drizzle-orm";
import { Elysia } from "elysia";
import { profiles } from "@deadline-radar/db";
import {
  summarizeDeadlineBuckets,
  type ProgressSummary,
} from "@deadline-radar/domain";

import { requireAuthPlugin } from "../plugins/auth";
import { getDb } from "../lib/db";
import { ApiError, apiDoc, envelope, secured } from "../lib/api";

/** Postgres rejects unknown timezones, same as Intl — validate once up front. */
function resolveTimeZone(raw: string | null | undefined): string {
  if (!raw) return "UTC";
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: raw }).format(new Date());
    return raw;
  } catch {
    return "UTC";
  }
}

/**
 * Summary bucket counts for the signed-in user.
 * Counts come from ALL non-deleted tasks (no pagination) so the numbers are
 * exact, and the buckets are computed in Postgres in the profile timezone,
 * falling back to UTC when the timezone is missing/invalid. The API ships
 * 7 ints + progress — never N task rows. Bucket semantics mirror the shared
 * domain summarizers (kept canonical for web consumers); see
 * supabase/migrations/20260921010000_summary_rpc.sql.
 */
export const summaryRoutes = new Elysia({ prefix: "/api/v1/summary" })
  .use(requireAuthPlugin)
  .get(
    "/",
    async ({
      requireAuthz,
    }): Promise<{
      summary: ReturnType<typeof summarizeDeadlineBuckets>;
      progress: ProgressSummary;
    }> => {
      const ctx = await requireAuthz("task.view");
      const db = getDb();

      const [profile] = await db
        .select({ timezone: profiles.timezone })
        .from(profiles)
        .where(eq(profiles.id, ctx.subject.id))
        .limit(1);
      const timeZone = resolveTimeZone(profile?.timezone);

      // Single round trip: Postgres aggregates buckets + progress over the
      // full history (GROUP BY, tz-aware day keys) and returns 7 ints +
      // progress. p_user_id is the authenticated subject — never client input
      // (the RPC is SECURITY DEFINER with an explicit tenancy predicate).
      const now = new Date();
      const rows = (await db.execute(
        sql`select public.get_user_summary(${ctx.subject.id}, ${timeZone}, ${now.toISOString()}::timestamptz) as summary`,
      )) as unknown as { summary: unknown }[];
      const result = rows[0]?.summary as
        | {
            summary: ReturnType<typeof summarizeDeadlineBuckets>;
            progress: ProgressSummary;
          }
        | null
        | undefined;
      if (!result) throw ApiError.internal("Summary unavailable");

      return result;
    },
    {
      detail: {
        tags: ["Summary"],
        summary: "Get summary bucket counts",
        ...secured(),
        ...apiDoc({
          ok: envelope(
            {
              summary: {
                type: "object",
                required: [
                  "today",
                  "tomorrow",
                  "thisWeek",
                  "nextWeek",
                  "thisMonth",
                  "missed",
                  "allTasks",
                ],
                properties: {
                  today: { type: "integer" },
                  tomorrow: { type: "integer" },
                  thisWeek: { type: "integer" },
                  nextWeek: { type: "integer" },
                  thisMonth: { type: "integer" },
                  missed: { type: "integer" },
                  allTasks: { type: "integer" },
                },
              },
              progress: {
                type: "object",
                required: [
                  "completed",
                  "total",
                  "onTime",
                  "onTimeTotal",
                  "courses",
                ],
                properties: {
                  completed: { type: "integer" },
                  total: { type: "integer" },
                  onTime: { type: "integer" },
                  onTimeTotal: { type: "integer" },
                  courses: { type: "array", items: { type: "object" } },
                },
              },
            },
            ["summary", "progress"],
          ),
          description:
            "Exact counts over ALL non-deleted tasks (no pagination) in " +
            "the profile timezone, plus completion/on-time progress.",
          errors: [401, 403, 429],
        }),
      },
    },
  );