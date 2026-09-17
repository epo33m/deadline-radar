import { and, desc, eq, isNull, lt, or } from "drizzle-orm";
import { Elysia, t } from "elysia";
import { coursePatchSchema, courseSchema } from "@deadline-radar/validation";
import { courses } from "@deadline-radar/db";

import { requireAuthPlugin } from "../plugins/auth";
import { getDb } from "../lib/db";
import {
  assertNoForbiddenMutationKeys,
  ownedCourse,
} from "../lib/authorization";
import {
  ApiError,
  beginIdempotent,
  completeIdempotent,
  decodeCursor,
  encodeCursor,
  pageMeta,
  parsePaginationQuery,
  readIdempotencyKey,
  readJsonBody,
  serializeCourse,
  validationFromZod,
  jsonBodyDetail,
  openApiBodies,
} from "../lib/api";

function normalizeCourseColor(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  return trimmed.startsWith("#")
    ? trimmed.toLowerCase()
    : `#${trimmed.toLowerCase()}`;
}

function normalizeCourseIcon(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const trimmed = raw.trim().toLowerCase();
  if (!trimmed) return null;
  return trimmed;
}

function assertFreshUpdatedAt(
  rowUpdatedAt: Date | string,
  clientUpdatedAt: string | undefined,
): void {
  if (!clientUpdatedAt) return;
  const server = new Date(rowUpdatedAt).getTime();
  const client = new Date(clientUpdatedAt).getTime();
  if (!Number.isFinite(client) || server !== client) {
    throw ApiError.conflict("Resource was modified; refresh and retry", [
      { field: "updatedAt", message: "Stale updatedAt" },
    ]);
  }
}

export const courseRoutes = new Elysia({ prefix: "/api/v1/courses" })
  .use(requireAuthPlugin)
  .get(
    "/",
    async ({ requireAuthz, query }) => {
      const ctx = await requireAuthz("course.view");
      const { limit, cursor } = parsePaginationQuery({
        limit: query.limit,
        cursor: query.cursor,
      });
      const decoded = decodeCursor(cursor);

      const rows = await getDb()
        .select()
        .from(courses)
        .where(
          and(
            eq(courses.userId, ctx.subject.id),
            isNull(courses.deletedAt),
            decoded
              ? or(
                  lt(courses.createdAt, new Date(decoded.k)),
                  and(
                    eq(courses.createdAt, new Date(decoded.k)),
                    lt(courses.id, decoded.id),
                  ),
                )
              : undefined,
          ),
        )
        .orderBy(desc(courses.createdAt), desc(courses.id))
        .limit(limit + 1);

      const pageRows = rows.slice(0, limit);
      const last = pageRows[pageRows.length - 1];
      const nextCursor =
        rows.length > limit && last
          ? encodeCursor({
              v: 1,
              k: new Date(last.createdAt).toISOString(),
              id: last.id,
            })
          : null;

      return {
        courses: pageRows.map(serializeCourse),
        page: pageMeta(limit, nextCursor),
      };
    },
    {
      query: t.Object({
        limit: t.Optional(t.String()),
        cursor: t.Optional(t.String()),
      }),
      detail: { tags: ["Courses"], summary: "List courses" },
    },
  )
  .get(
    "/:id",
    async ({ params, requireAuthz }) => {
      const ctx = await requireAuthz("course.view");
      const row = await ownedCourse(ctx.subject.id, params.id);
      if (!row) throw ApiError.notFound("Course not found");
      return { course: serializeCourse(row) };
    },
    {
      params: t.Object({ id: t.String({ format: "uuid" }) }),
      detail: { tags: ["Courses"], summary: "Get course" },
    },
  )
  .post(
    "/",
    async ({ requireAuthz, request, set }) => {
      const ctx = await requireAuthz("course.create");
      const body = (await readJsonBody(request)) as {
        name?: string;
        code?: string | null;
        color?: string | null;
        icon?: string | null;
        description?: string | null;
      };
      assertNoForbiddenMutationKeys(body);
      const idemKey = readIdempotencyKey(request);
      if (idemKey) {
        const { replay } = await beginIdempotent({
          userId: ctx.subject.id,
          key: idemKey,
          method: "POST",
          path: "/api/v1/courses",
          body,
        });
        if (replay) {
          set.status = replay.statusCode;
          return replay.body;
        }
      }

      const parsed = courseSchema.safeParse({
        ...body,
        color: normalizeCourseColor(body.color ?? null),
        icon: normalizeCourseIcon(body.icon ?? null),
      });
      if (!parsed.success) {
        throw validationFromZod(
          "Invalid course details",
          parsed.error.flatten().fieldErrors,
        );
      }
      const [row] = await getDb()
        .insert(courses)
        .values({
          userId: ctx.subject.id,
          name: parsed.data.name,
          code: parsed.data.code,
          color: parsed.data.color,
          icon: parsed.data.icon,
          description: parsed.data.description,
        })
        .returning();
      const response = { course: serializeCourse(row) };
      if (idemKey) {
        await completeIdempotent({
          userId: ctx.subject.id,
          key: idemKey,
          statusCode: 200,
          body: response,
        });
      }
      return response;
    },
    {
      detail: {
        tags: ["Courses"],
        summary: "Create course",
        requestBody: jsonBodyDetail(openApiBodies.courseCreate),
      },
    },
  )
  .patch(
    "/:id",
    async ({ params, requireAuthz, request }) => {
      const ctx = await requireAuthz("course.update");
      const body = (await readJsonBody(request)) as {
        name?: string;
        code?: string | null;
        color?: string | null;
        icon?: string | null;
        description?: string | null;
        updatedAt?: string;
        updated_at?: string;
      };
      assertNoForbiddenMutationKeys(body);
      const parsed = coursePatchSchema.safeParse({
        ...body,
        color: normalizeCourseColor(body.color ?? null),
        icon: normalizeCourseIcon(body.icon ?? null),
      });
      if (!parsed.success) {
        throw validationFromZod(
          "Invalid course details",
          parsed.error.flatten().fieldErrors,
        );
      }
      const existing = await ownedCourse(ctx.subject.id, params.id);
      if (!existing) throw ApiError.notFound("Course not found");
      const clientUpdatedAt = parsed.data.updatedAt ?? parsed.data.updated_at;
      assertFreshUpdatedAt(
        existing.updatedAt ?? existing.createdAt,
        clientUpdatedAt,
      );

      const [row] = await getDb()
        .update(courses)
        .set({
          name: parsed.data.name,
          code: parsed.data.code,
          color: parsed.data.color,
          icon: parsed.data.icon,
          description: parsed.data.description,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(courses.id, params.id),
            eq(courses.userId, ctx.subject.id),
            isNull(courses.deletedAt),
          ),
        )
        .returning();
      if (!row) throw ApiError.notFound("Course not found");
      return { course: serializeCourse(row) };
    },
    {
      params: t.Object({ id: t.String({ format: "uuid" }) }),
      detail: {
        tags: ["Courses"],
        summary: "Update course",
        requestBody: jsonBodyDetail(openApiBodies.coursePatch),
      },
    },
  )
  .delete(
    "/:id",
    async ({ params, requireAuthz }) => {
      const ctx = await requireAuthz("course.archive");
      const [row] = await getDb()
        .update(courses)
        .set({ deletedAt: new Date(), updatedAt: new Date() })
        .where(
          and(
            eq(courses.id, params.id),
            eq(courses.userId, ctx.subject.id),
            isNull(courses.deletedAt),
          ),
        )
        .returning();
      if (!row) throw ApiError.notFound("Course not found");
      return { ok: true };
    },
    {
      params: t.Object({ id: t.String({ format: "uuid" }) }),
      detail: { tags: ["Courses"], summary: "Soft-delete course" },
    },
  );
