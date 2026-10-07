import { and, desc, eq, isNull, lt, or } from "drizzle-orm";
import { Elysia, t } from "elysia";
import { coursePatchSchema, courseSchema } from "@deadline-radar/validation";
import { courses } from "@deadline-radar/db";

import { requireAuthPlugin } from "../plugins/auth";
import { getDb } from "../lib/db";
import {
  assertNoForbiddenMutationKeys,
  ownedCourse,
  ownedCourseInTx,
  withUserRls,
} from "../lib/authorization";
import {
  ApiError,
  apiDoc,
  beginIdempotent,
  completeIdempotent,
  decodeCursor,
  encodeCursor,
  envelope,
  idempotent,
  pageMeta,
  parsePaginationQuery,
  R,
  readIdempotencyKey,
  readJsonBody,
  releaseIdempotentOnClientError,
  secured,
  serializeCourse,
  validationFromZod,
  jsonBodyDetail,
  openApiBodies,
} from "../lib/api";

function normalizeCourseColor(
  raw: string | null | undefined,
): string | null | undefined {
  if (raw === undefined) return undefined;
  if (!raw) return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  return trimmed.startsWith("#")
    ? trimmed.toLowerCase()
    : `#${trimmed.toLowerCase()}`;
}

function normalizeCourseIcon(
  raw: string | null | undefined,
): string | null | undefined {
  if (raw === undefined) return undefined;
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
      detail: {
        tags: ["Courses"],
        summary: "List courses",
        ...secured(),
        ...apiDoc({
          ok: envelope(
            {
              courses: { type: "array", items: R("Course") },
              page: R("Page"),
            },
            ["courses", "page"],
          ),
          errors: [400, 401, 403, 429],
        }),
      },
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
      detail: {
        tags: ["Courses"],
        summary: "Get course",
        ...secured(),
        ...apiDoc({
          ok: envelope({ course: R("Course") }, ["course"]),
          errors: [401, 403, 404, 429],
        }),
      },
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

      // #136: parse before claiming so an invalid body never poisons the key.
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

      let row;
      try {
        [row] = await getDb()
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
      } catch (error) {
        // #136: a 4xx after the claim frees it for a corrected same-key retry.
        await releaseIdempotentOnClientError(error, {
          userId: ctx.subject.id,
          key: idemKey,
        });
        throw error;
      }
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
        ...secured(),
        ...apiDoc({
          ok: envelope({ course: R("Course") }, ["course"]),
          errors: [400, 401, 403, 409, 429],
        }),
        ...idempotent(),
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
        ...(body.color !== undefined
          ? { color: normalizeCourseColor(body.color) }
          : {}),
        ...(body.icon !== undefined
          ? { icon: normalizeCourseIcon(body.icon) }
          : {}),
      });
      if (!parsed.success) {
        throw validationFromZod(
          "Invalid course details",
          parsed.error.flatten().fieldErrors,
        );
      }

      const updates: Record<string, unknown> = {};
      if (parsed.data.name !== undefined) updates.name = parsed.data.name;
      if (parsed.data.code !== undefined) updates.code = parsed.data.code;
      if (parsed.data.color !== undefined) updates.color = parsed.data.color;
      if (parsed.data.icon !== undefined) updates.icon = parsed.data.icon;
      if (parsed.data.description !== undefined)
        updates.description = parsed.data.description;

      if (Object.keys(updates).length === 0) {
        throw ApiError.validation("At least one field must be provided to update");
      }

      // Check + mutate + conditional re-read in one transaction (P2-3).
      return withUserRls(ctx.subject.id, async (tx) => {
        const existing = await ownedCourseInTx(tx, ctx.subject.id, params.id);
        if (!existing) throw ApiError.notFound("Course not found");
        const clientUpdatedAt = parsed.data.updatedAt ?? parsed.data.updated_at;
        assertFreshUpdatedAt(
          existing.updatedAt ?? existing.createdAt,
          clientUpdatedAt,
        );

        updates.updatedAt = new Date();

        const [row] = await tx
          .update(courses)
          .set(updates)
          .where(
            and(
              eq(courses.id, params.id),
              eq(courses.userId, ctx.subject.id),
              isNull(courses.deletedAt),
              clientUpdatedAt
                ? eq(
                    courses.updatedAt,
                    new Date(existing.updatedAt ?? existing.createdAt),
                  )
                : undefined,
            ),
          )
          .returning();
        if (!row) {
          const check = await ownedCourseInTx(tx, ctx.subject.id, params.id);
          if (check && clientUpdatedAt) {
            throw ApiError.conflict("Resource was modified; refresh and retry", [
              { field: "updatedAt", message: "Stale updatedAt" },
            ]);
          }
          throw ApiError.notFound("Course not found");
        }
        return { course: serializeCourse(row) };
      });
    },
    {
      params: t.Object({ id: t.String({ format: "uuid" }) }),
      detail: {
        tags: ["Courses"],
        summary: "Update course",
        requestBody: jsonBodyDetail(openApiBodies.coursePatch),
        ...secured(),
        ...apiDoc({
          ok: envelope({ course: R("Course") }, ["course"]),
          errors: [400, 401, 403, 404, 409, 429],
        }),
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
      detail: {
        tags: ["Courses"],
        summary: "Soft-delete course",
        ...secured(),
        ...apiDoc({
          ok: envelope({ ok: { type: "boolean" } }, ["ok"]),
          errors: [401, 403, 404, 429],
        }),
      },
    },
  );
