import { Elysia, t } from "elysia";
import { and, eq, isNull } from "drizzle-orm";
import { courseSchema } from "@deadline-radar/validation";
import { courses } from "@deadline-radar/db";

import { requireAuthPlugin } from "../plugins/auth";
import { getDb } from "../lib/db";
import {
  assertNoForbiddenMutationKeys,
  ForbiddenFieldError,
  ownedCourse,
} from "../lib/authorization";

function normalizeCourseColor(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  return trimmed.startsWith("#") ? trimmed.toLowerCase() : `#${trimmed.toLowerCase()}`;
}

export const courseRoutes = new Elysia({ prefix: "/api/courses" })
  .use(requireAuthPlugin)
  .get(
    "/",
    async ({ requireAuthz }) => {
      const ctx = await requireAuthz("course.view");
      const rows = await getDb()
        .select()
        .from(courses)
        .where(
          and(eq(courses.userId, ctx.subject.id), isNull(courses.deletedAt)),
        );
      return { courses: rows };
    },
    { detail: { tags: ["Courses"], summary: "List courses" } },
  )
  .get(
    "/:id",
    async ({ params, requireAuthz, set }) => {
      const ctx = await requireAuthz("course.view");
      const row = await ownedCourse(ctx.subject.id, params.id);
      if (!row) {
        set.status = 404;
        return { error: "Course not found" };
      }
      return { course: row };
    },
    {
      params: t.Object({ id: t.String() }),
      detail: { tags: ["Courses"], summary: "Get course" },
    },
  )
  .post(
    "/",
    async ({ body, requireAuthz, set }) => {
      const ctx = await requireAuthz("course.create");
      try {
        assertNoForbiddenMutationKeys(body);
      } catch (e) {
        if (e instanceof ForbiddenFieldError) {
          set.status = 400;
          return { error: "Invalid course details" };
        }
        throw e;
      }
      const parsed = courseSchema.safeParse({
        ...body,
        color: normalizeCourseColor(body.color ?? null),
      });
      if (!parsed.success) {
        set.status = 400;
        return {
          error: "Invalid course details",
          fieldErrors: parsed.error.flatten().fieldErrors,
        };
      }
      const [row] = await getDb()
        .insert(courses)
        .values({
          userId: ctx.subject.id,
          name: parsed.data.name,
          code: parsed.data.code,
          color: parsed.data.color,
        })
        .returning();
      return { course: row };
    },
    {
      body: t.Object({
        name: t.String(),
        code: t.Optional(t.Union([t.String(), t.Null()])),
        color: t.Optional(t.Union([t.String(), t.Null()])),
      }),
      detail: { tags: ["Courses"], summary: "Create course" },
    },
  )
  .patch(
    "/:id",
    async ({ params, body, requireAuthz, set }) => {
      const ctx = await requireAuthz("course.update");
      try {
        assertNoForbiddenMutationKeys(body);
      } catch (e) {
        if (e instanceof ForbiddenFieldError) {
          set.status = 400;
          return { error: "Invalid course details" };
        }
        throw e;
      }
      const parsed = courseSchema.safeParse({
        ...body,
        color: normalizeCourseColor(body.color ?? null),
      });
      if (!parsed.success) {
        set.status = 400;
        return {
          error: "Invalid course details",
          fieldErrors: parsed.error.flatten().fieldErrors,
        };
      }
      const [row] = await getDb()
        .update(courses)
        .set({
          name: parsed.data.name,
          code: parsed.data.code,
          color: parsed.data.color,
        })
        .where(
          and(
            eq(courses.id, params.id),
            eq(courses.userId, ctx.subject.id),
            isNull(courses.deletedAt),
          ),
        )
        .returning();
      if (!row) {
        set.status = 404;
        return { error: "Course not found" };
      }
      return { course: row };
    },
    {
      params: t.Object({ id: t.String() }),
      body: t.Object({
        name: t.String(),
        code: t.Optional(t.Union([t.String(), t.Null()])),
        color: t.Optional(t.Union([t.String(), t.Null()])),
      }),
      detail: { tags: ["Courses"], summary: "Update course" },
    },
  )
  .delete(
    "/:id",
    async ({ params, requireAuthz, set }) => {
      const ctx = await requireAuthz("course.archive");
      const [row] = await getDb()
        .update(courses)
        .set({ deletedAt: new Date() })
        .where(
          and(
            eq(courses.id, params.id),
            eq(courses.userId, ctx.subject.id),
            isNull(courses.deletedAt),
          ),
        )
        .returning();
      if (!row) {
        set.status = 404;
        return { error: "Course not found" };
      }
      return { ok: true };
    },
    {
      params: t.Object({ id: t.String() }),
      detail: { tags: ["Courses"], summary: "Soft-delete course" },
    },
  );
