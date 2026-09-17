import { and, eq, isNull } from "drizzle-orm";
import { Elysia } from "elysia";
import { courses, profiles, tasks } from "@deadline-radar/db";
import {
  summarizeDeadlineBuckets,
  summarizeProgress,
  type ProgressSummary,
} from "@deadline-radar/domain";

import { requireAuthPlugin } from "../plugins/auth";
import { getDb } from "../lib/db";

/**
 * Summary bucket counts for the signed-in user.
 * Counts come from ALL non-deleted tasks (no pagination) so the numbers are
 * exact, and the buckets are computed in the profile timezone, falling back to
 * UTC when the timezone is missing. Progress stats (completion, on-time rate,
 * per-course workload) ride along in the same response.
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
      const timeZone = profile?.timezone ?? "UTC";

      const rows = await db
        .select({
          deadline: tasks.deadline,
          status: tasks.status,
          completedAt: tasks.completedAt,
          courseName: courses.name,
          courseColor: courses.color,
        })
        .from(tasks)
        .leftJoin(
          courses,
          and(eq(tasks.courseId, courses.id), isNull(courses.deletedAt)),
        )
        .where(
          and(
            eq(tasks.userId, ctx.subject.id),
            isNull(tasks.deletedAt),
          ),
        );

      const summary = summarizeDeadlineBuckets(
        rows.map((row) => ({
          deadline: new Date(row.deadline).toISOString(),
          status: row.status,
        })),
        timeZone,
      );

      const progress = summarizeProgress(
        rows.map((row) => ({
          status: row.status,
          deadline: new Date(row.deadline).toISOString(),
          completedAt: row.completedAt
            ? new Date(row.completedAt).toISOString()
            : null,
          courseName: row.courseName,
          courseColor: row.courseColor,
        })),
      );

      return { summary, progress };
    },
    {
      detail: { tags: ["Summary"], summary: "Get summary bucket counts" },
    },
  );