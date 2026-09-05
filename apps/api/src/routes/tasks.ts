import { and, asc, desc, eq, gt, isNull, lt, or } from "drizzle-orm";
import { Elysia, t } from "elysia";
import {
  reminderThresholdSchema,
  taskPatchSchema,
  taskSchema,
} from "@deadline-radar/validation";
import {
  attachments,
  courses,
  reminderThresholds,
  tasks,
} from "@deadline-radar/db";

import { requireAuthPlugin } from "../plugins/auth";
import { getDb } from "../lib/db";
import {
  assertNoForbiddenMutationKeys,
  ownedCourse,
  ownedTask,
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
  serializeAttachment,
  serializeCourse,
  serializeTask,
  serializeThreshold,
  validationFromZod,
  jsonBodyDetail,
  openApiBodies,
} from "../lib/api";

const ALLOWED_TASK_SORT = new Set(["deadline", "createdAt"]);

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

export const taskRoutes = new Elysia({ prefix: "/api/v1/tasks" })
  .use(requireAuthPlugin)
  .get(
    "/",
    async ({ requireAuthz, query }) => {
      const ctx = await requireAuthz("task.view");
      const { limit, cursor } = parsePaginationQuery(query);
      const sort =
        typeof query.sort === "string" && ALLOWED_TASK_SORT.has(query.sort)
          ? query.sort
          : "deadline";
      if (query.sort && !ALLOWED_TASK_SORT.has(String(query.sort))) {
        throw ApiError.validation("Invalid sort field", [
          {
            field: "sort",
            message: "Allowed: deadline, createdAt",
          },
        ]);
      }
      const decoded = decodeCursor(cursor);
      const db = getDb();

      const orderCol = sort === "createdAt" ? tasks.createdAt : tasks.deadline;

      const rows = await db
        .select({
          id: tasks.id,
          userId: tasks.userId,
          courseId: tasks.courseId,
          title: tasks.title,
          description: tasks.description,
          deadline: tasks.deadline,
          status: tasks.status,
          estimatedDuration: tasks.estimatedDuration,
          createdAt: tasks.createdAt,
          updatedAt: tasks.updatedAt,
          courseName: courses.name,
          courseColor: courses.color,
        })
        .from(tasks)
        .leftJoin(courses, eq(tasks.courseId, courses.id))
        .where(
          and(
            eq(tasks.userId, ctx.subject.id),
            isNull(tasks.deletedAt),
            query.courseId ? eq(tasks.courseId, query.courseId) : undefined,
            decoded
              ? or(
                  gt(orderCol, new Date(decoded.k)),
                  and(eq(orderCol, new Date(decoded.k)), gt(tasks.id, decoded.id)),
                )
              : undefined,
          ),
        )
        .orderBy(asc(orderCol), asc(tasks.id))
        .limit(limit + 1);

      const pageRows = rows.slice(0, limit);
      const last = pageRows[pageRows.length - 1];
      const nextCursor =
        rows.length > limit && last
          ? encodeCursor({
              v: 1,
              k: new Date(
                sort === "createdAt" ? last.createdAt : last.deadline,
              ).toISOString(),
              id: last.id,
            })
          : null;

      return {
        tasks: pageRows.map(serializeTask),
        page: pageMeta(limit, nextCursor),
      };
    },
    {
      query: t.Object({
        courseId: t.Optional(t.String({ format: "uuid" })),
        limit: t.Optional(t.String()),
        cursor: t.Optional(t.String()),
        sort: t.Optional(t.String()),
      }),
      detail: { tags: ["Tasks"], summary: "List tasks" },
    },
  )
  .get(
    "/:id",
    async ({ params, requireAuthz }) => {
      const ctx = await requireAuthz("task.view");
      const task = await ownedTask(ctx.subject.id, params.id);
      if (!task) throw ApiError.notFound("Task not found");
      const db = getDb();
      const [course] = await db
        .select()
        .from(courses)
        .where(eq(courses.id, task.courseId))
        .limit(1);
      const thresholds = await db
        .select()
        .from(reminderThresholds)
        .where(eq(reminderThresholds.taskId, task.id))
        .orderBy(asc(reminderThresholds.daysBefore));
      const files = await db
        .select()
        .from(attachments)
        .where(eq(attachments.taskId, task.id));
      return {
        task: serializeTask(task),
        course: course ? serializeCourse(course) : null,
        thresholds: thresholds.map(serializeThreshold),
        attachments: files.map(serializeAttachment),
      };
    },
    {
      params: t.Object({ id: t.String({ format: "uuid" }) }),
      detail: { tags: ["Tasks"], summary: "Get task detail" },
    },
  )
  .post(
    "/",
    async ({ requireAuthz, request, set }) => {
      const ctx = await requireAuthz("task.create");
      const body = await readJsonBody(request);
      assertNoForbiddenMutationKeys(body);
      const idemKey = readIdempotencyKey(request);
      if (idemKey) {
        const { replay } = await beginIdempotent({
          userId: ctx.subject.id,
          key: idemKey,
          method: "POST",
          path: "/api/v1/tasks",
          body,
        });
        if (replay) {
          set.status = replay.statusCode;
          return replay.body;
        }
      }

      const parsed = taskSchema.safeParse(body);
      if (!parsed.success) {
        throw validationFromZod(
          "Invalid task details",
          parsed.error.flatten().fieldErrors,
        );
      }

      const course = await ownedCourse(ctx.subject.id, parsed.data.course_id);
      if (!course) throw ApiError.validation("Course not found");

      const [row] = await getDb()
        .insert(tasks)
        .values({
          userId: ctx.subject.id,
          courseId: parsed.data.course_id,
          title: parsed.data.title,
          description: parsed.data.description,
          deadline: new Date(parsed.data.deadline),
          status: parsed.data.status,
          estimatedDuration: parsed.data.estimated_duration,
        })
        .returning();

      const response = {
        task: serializeTask(row),
        redirectTo: `/tasks/${row.id}`,
      };
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
        tags: ["Tasks"],
        summary: "Create task",
        requestBody: jsonBodyDetail(openApiBodies.taskCreate),
      },
    },
  )
  .patch(
    "/:id",
    async ({ params, requireAuthz, request }) => {
      const ctx = await requireAuthz("task.update");
      const body = await readJsonBody(request);
      assertNoForbiddenMutationKeys(body);
      const parsed = taskPatchSchema.safeParse(body);
      if (!parsed.success) {
        throw validationFromZod(
          "Invalid task details",
          parsed.error.flatten().fieldErrors,
        );
      }
      const existing = await ownedTask(ctx.subject.id, params.id);
      if (!existing) throw ApiError.notFound("Task not found");

      assertFreshUpdatedAt(
        existing.updatedAt,
        parsed.data.updatedAt ?? parsed.data.updated_at,
      );

      const course = await ownedCourse(ctx.subject.id, parsed.data.course_id);
      if (!course) throw ApiError.validation("Course not found");

      const [row] = await getDb()
        .update(tasks)
        .set({
          courseId: parsed.data.course_id,
          title: parsed.data.title,
          description: parsed.data.description,
          deadline: new Date(parsed.data.deadline),
          status: parsed.data.status,
          estimatedDuration: parsed.data.estimated_duration,
          updatedAt: new Date(),
        })
        .where(and(eq(tasks.id, params.id), eq(tasks.userId, ctx.subject.id)))
        .returning();
      return { task: serializeTask(row) };
    },
    {
      params: t.Object({ id: t.String({ format: "uuid" }) }),
      detail: {
        tags: ["Tasks"],
        summary: "Update task",
        requestBody: jsonBodyDetail(openApiBodies.taskPatch),
      },
    },
  )
  .post(
    "/:id/complete",
    async ({ params, requireAuthz }) => {
      const ctx = await requireAuthz("task.update");
      const existing = await ownedTask(ctx.subject.id, params.id);
      if (!existing) throw ApiError.notFound("Task not found");
      if (existing.status === "done") {
        return { task: serializeTask(existing) };
      }
      const [row] = await getDb()
        .update(tasks)
        .set({ status: "done", updatedAt: new Date() })
        .where(and(eq(tasks.id, params.id), eq(tasks.userId, ctx.subject.id)))
        .returning();
      return { task: serializeTask(row) };
    },
    {
      params: t.Object({ id: t.String({ format: "uuid" }) }),
      detail: { tags: ["Tasks"], summary: "Mark task done" },
    },
  )
  .delete(
    "/:id",
    async ({ params, requireAuthz }) => {
      const ctx = await requireAuthz("task.archive");
      const [row] = await getDb()
        .update(tasks)
        .set({ deletedAt: new Date(), updatedAt: new Date() })
        .where(
          and(
            eq(tasks.id, params.id),
            eq(tasks.userId, ctx.subject.id),
            isNull(tasks.deletedAt),
          ),
        )
        .returning();
      if (!row) throw ApiError.notFound("Task not found");
      return { ok: true };
    },
    {
      params: t.Object({ id: t.String({ format: "uuid" }) }),
      detail: { tags: ["Tasks"], summary: "Soft-delete task" },
    },
  )
  .post(
    "/:id/thresholds",
    async ({ params, requireAuthz, request }) => {
      const ctx = await requireAuthz("threshold.manage");
      const body = await readJsonBody(request);
      assertNoForbiddenMutationKeys(body);
      const task = await ownedTask(ctx.subject.id, params.id);
      if (!task) throw ApiError.notFound("Task not found");
      const parsed = reminderThresholdSchema.safeParse(body);
      if (!parsed.success) {
        throw validationFromZod(
          "Invalid threshold",
          parsed.error.flatten().fieldErrors,
        );
      }
      try {
        const [row] = await getDb()
          .insert(reminderThresholds)
          .values({
            taskId: task.id,
            daysBefore: parsed.data.days_before,
            isDefault: false,
          })
          .returning();
        return { threshold: serializeThreshold(row) };
      } catch {
        throw ApiError.conflict(
          "Threshold already exists for this day offset",
        );
      }
    },
    {
      params: t.Object({ id: t.String({ format: "uuid" }) }),
      detail: {
        tags: ["Tasks"],
        summary: "Add reminder threshold",
        requestBody: jsonBodyDetail(openApiBodies.threshold),
      },
    },
  )
  .patch(
    "/:id/thresholds/:thresholdId",
    async ({ params, requireAuthz, request }) => {
      const ctx = await requireAuthz("threshold.manage");
      const body = await readJsonBody(request);
      assertNoForbiddenMutationKeys(body);
      const task = await ownedTask(ctx.subject.id, params.id);
      if (!task) throw ApiError.notFound("Task not found");
      const parsed = reminderThresholdSchema.safeParse(body);
      if (!parsed.success) {
        throw validationFromZod(
          "Invalid threshold",
          parsed.error.flatten().fieldErrors,
        );
      }
      const [row] = await getDb()
        .update(reminderThresholds)
        .set({
          daysBefore: parsed.data.days_before,
          isDefault: false,
        })
        .where(
          and(
            eq(reminderThresholds.id, params.thresholdId),
            eq(reminderThresholds.taskId, task.id),
          ),
        )
        .returning();
      if (!row) throw ApiError.notFound("Threshold not found");
      return { threshold: serializeThreshold(row) };
    },
    {
      params: t.Object({
        id: t.String({ format: "uuid" }),
        thresholdId: t.String({ format: "uuid" }),
      }),
      detail: {
        tags: ["Tasks"],
        summary: "Update reminder threshold",
        requestBody: jsonBodyDetail(openApiBodies.threshold),
      },
    },
  )
  .delete(
    "/:id/thresholds/:thresholdId",
    async ({ params, requireAuthz }) => {
      const ctx = await requireAuthz("threshold.manage");
      const task = await ownedTask(ctx.subject.id, params.id);
      if (!task) throw ApiError.notFound("Task not found");
      const [row] = await getDb()
        .delete(reminderThresholds)
        .where(
          and(
            eq(reminderThresholds.id, params.thresholdId),
            eq(reminderThresholds.taskId, task.id),
          ),
        )
        .returning();
      if (!row) throw ApiError.notFound("Threshold not found");
      return { ok: true };
    },
    {
      params: t.Object({
        id: t.String({ format: "uuid" }),
        thresholdId: t.String({ format: "uuid" }),
      }),
      detail: { tags: ["Tasks"], summary: "Remove reminder threshold" },
    },
  );
