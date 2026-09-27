import { and, desc, eq, isNull } from "drizzle-orm";
import { sql } from "drizzle-orm";
import { Elysia } from "elysia";
import { courses, profiles } from "@deadline-radar/db";
import {
  summarizeDeadlineBuckets,
  type ProgressSummary,
} from "@deadline-radar/domain";

import { requireAuthPlugin } from "../plugins/auth";
import { getDb } from "../lib/db";
import {
  getCachedBootstrap,
  setCachedBootstrap,
} from "../lib/bootstrap-cache";
import { ApiError, apiDoc, envelope, R, secured, serializeCourse } from "../lib/api";
import { resolveTimeZone } from "./summary";

/**
 * Cold-navigation bootstrap for the signed-in user (perf plan, Fase E).
 *
 * A first paint of any `(app)` page needs the same three pieces: the
 * session user, the course list (names/colors for every task row), and the
 * summary aggregates. Fetching them as three HTTP calls triples the
 * per-navigation cost (Redis + JWT + authz + DB round trips each), so this
 * endpoint returns all three in ONE call and ONE parallel query batch.
 *
 * Semantics mirror the three source endpoints exactly (`GET /auth/session`
 * without the Supabase `getUser` lookup, `GET /courses` uncursored,
 * `GET /summary`); capabilities are the union of theirs and fail closed.
 * `pendingEmail` is always null here — email-change status stays on
 * `/auth/session`, whose contract (and tests) are untouched.
 *
 * The course list is capped at 200 rows (same order as the list endpoint).
 * There is no course-count quota, but 200 matches the task-quota scale and
 * keeps the payload bounded; the paginated `GET /courses` remains for
 * complete enumeration.
 */
export type BootstrapResponse = {
  user: {
    id: string;
    email?: string;
    timezone: string;
    timeFormat: "12h" | "24h";
    name: string | null;
    sessionId: string | null;
    pendingEmail: null;
  };
  courses: ReturnType<typeof serializeCourse>[];
  summary: ReturnType<typeof summarizeDeadlineBuckets>;
  progress: ProgressSummary;
};

export const bootstrapRoutes = new Elysia({ prefix: "/api/v1/bootstrap" })
  .use(requireAuthPlugin)
  .get(
    "/",
    async ({ user, requireAuthz }): Promise<BootstrapResponse> => {
      if (!user) throw ApiError.unauthorized();
      // Union of the source endpoints' capabilities — fail closed.
      await requireAuthz("profile.view");
      await requireAuthz("course.view");
      await requireAuthz("task.view");

      const cached = getCachedBootstrap(user.id) as BootstrapResponse | null;
      if (cached) return cached;

      const db = getDb();
      const [profileRows, courseRows] = await Promise.all([
        db
          .select()
          .from(profiles)
          .where(eq(profiles.id, user.id))
          .limit(1),
        db
          .select()
          .from(courses)
          .where(
            and(eq(courses.userId, user.id), isNull(courses.deletedAt)),
          )
          .orderBy(desc(courses.createdAt), desc(courses.id))
          .limit(200),
      ]);
      const profile = profileRows[0];
      const timeZone = resolveTimeZone(profile?.timezone);

      const now = new Date();
      const summaryRows = (await db.execute(
        sql`select public.get_user_summary(${user.id}, ${timeZone}, ${now.toISOString()}::timestamptz) as summary`,
      )) as unknown as { summary: unknown }[];
      const result = summaryRows[0]?.summary as
        | {
            summary: ReturnType<typeof summarizeDeadlineBuckets>;
            progress: ProgressSummary;
          }
        | null
        | undefined;
      if (!result) throw ApiError.internal("Summary unavailable");

      const response: BootstrapResponse = {
        user: {
          id: user.id,
          email: user.email ?? profile?.email,
          timezone: profile?.timezone ?? "UTC",
          timeFormat: profile?.timeFormat ?? "24h",
          name: profile?.name ?? null,
          sessionId: user.sessionId ?? null,
          pendingEmail: null,
        },
        courses: courseRows.map(serializeCourse),
        summary: result.summary,
        progress: result.progress,
      };
      setCachedBootstrap(user.id, response);
      return response;
    },
    {
      detail: {
        tags: ["Bootstrap"],
        summary: "Cold-navigation bootstrap (user + courses + summary)",
        ...secured(),
        ...apiDoc({
          ok: envelope(
            {
              user: R("SessionUser"),
              courses: { type: "array", items: R("Course") },
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
            ["user", "courses", "summary", "progress"],
          ),
          description:
            "One call replacing session + course list + summary on cold " +
            "navigations. Same shapes, same capabilities, one round trip.",
          errors: [401, 403, 429],
        }),
      },
    },
  );
