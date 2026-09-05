import { Elysia, t } from "elysia";
import { and, asc, eq, isNull } from "drizzle-orm";
import {
  reminderThresholdSchema,
  taskSchema,
} from "@deadline-radar/validation";
import {
  courses,
  reminderThresholds,
  tasks,
  attachments,
} from "@deadline-radar/db";

import { authPlugin } from "../plugins/auth";
import { getDb } from "../lib/db";

async function ownedTask(userId: string, taskId: string) {
  const [row] = await getDb()
    .select()
    .from(tasks)
    .where(
      and(eq(tasks.id, taskId), eq(tasks.userId, userId), isNull(tasks.deletedAt)),
    )
    .limit(1);
  return row ?? null;
}

export const taskRoutes = new Elysia({ prefix: "/api/tasks" })
  .use(authPlugin)
  .get(
    "/",
    async ({ requireUser, query }) => {
      const user = requireUser();
      const db = getDb();
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
            eq(tasks.userId, user.id),
            isNull(tasks.deletedAt),
            query.courseId ? eq(tasks.courseId, query.courseId) : undefined,
          ),
        )
        .orderBy(asc(tasks.deadline));
      return { tasks: rows };
    },
    {
      query: t.Object({ courseId: t.Optional(t.String()) }),
      detail: { tags: ["Tasks"], summary: "List tasks" },
    },
  )
  .get(
    "/:id",
    async ({ params, requireUser, set }) => {
      const user = requireUser();
      const task = await ownedTask(user.id, params.id);
      if (!task) {
        set.status = 404;
        return { error: "Task not found" };
      }
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
      return { task, course: course ?? null, thresholds, attachments: files };
    },
    {
      params: t.Object({ id: t.String() }),
      detail: { tags: ["Tasks"], summary: "Get task detail" },
    },
  )
  .post(
    "/",
    async ({ body, requireUser, set }) => {
      const user = requireUser();
      const parsed = taskSchema.safeParse(body);
      if (!parsed.success) {
        set.status = 400;
        return {
          error: "Invalid task details",
          fieldErrors: parsed.error.flatten().fieldErrors,
        };
      }

      const [course] = await getDb()
        .select({ id: courses.id })
        .from(courses)
        .where(
          and(
            eq(courses.id, parsed.data.course_id),
            eq(courses.userId, user.id),
            isNull(courses.deletedAt),
          ),
        )
        .limit(1);
      if (!course) {
        set.status = 400;
        return { error: "Course not found" };
      }

      const [row] = await getDb()
        .insert(tasks)
        .values({
          userId: user.id,
          courseId: parsed.data.course_id,
          title: parsed.data.title,
          description: parsed.data.description,
          deadline: new Date(parsed.data.deadline),
          status: parsed.data.status,
          estimatedDuration: parsed.data.estimated_duration,
        })
        .returning();

      return { task: row, redirectTo: `/tasks/${row.id}` };
    },
    {
      body: t.Object({
        title: t.String(),
        course_id: t.String(),
        deadline: t.String(),
        status: t.Optional(t.String()),
        description: t.Optional(t.Union([t.String(), t.Null()])),
        estimated_duration: t.Optional(
          t.Union([t.Number(), t.String(), t.Null()]),
        ),
      }),
      detail: { tags: ["Tasks"], summary: "Create task" },
    },
  )
  .patch(
    "/:id",
    async ({ params, body, requireUser, set }) => {
      const user = requireUser();
      const parsed = taskSchema.safeParse(body);
      if (!parsed.success) {
        set.status = 400;
        return {
          error: "Invalid task details",
          fieldErrors: parsed.error.flatten().fieldErrors,
        };
      }
      const existing = await ownedTask(user.id, params.id);
      if (!existing) {
        set.status = 404;
        return { error: "Task not found" };
      }

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
        .where(eq(tasks.id, params.id))
        .returning();
      return { task: row };
    },
    {
      params: t.Object({ id: t.String() }),
      body: t.Object({
        title: t.String(),
        course_id: t.String(),
        deadline: t.String(),
        status: t.Optional(t.String()),
        description: t.Optional(t.Union([t.String(), t.Null()])),
        estimated_duration: t.Optional(
          t.Union([t.Number(), t.String(), t.Null()]),
        ),
      }),
      detail: { tags: ["Tasks"], summary: "Update task" },
    },
  )
  .post(
    "/:id/complete",
    async ({ params, requireUser, set }) => {
      const user = requireUser();
      const existing = await ownedTask(user.id, params.id);
      if (!existing) {
        set.status = 404;
        return { error: "Task not found" };
      }
      if (existing.status === "done") {
        return { task: existing };
      }
      const [row] = await getDb()
        .update(tasks)
        .set({ status: "done", updatedAt: new Date() })
        .where(eq(tasks.id, params.id))
        .returning();
      return { task: row };
    },
    {
      params: t.Object({ id: t.String() }),
      detail: { tags: ["Tasks"], summary: "Mark task done" },
    },
  )
  .delete(
    "/:id",
    async ({ params, requireUser, set }) => {
      const user = requireUser();
      const [row] = await getDb()
        .update(tasks)
        .set({ deletedAt: new Date(), updatedAt: new Date() })
        .where(
          and(
            eq(tasks.id, params.id),
            eq(tasks.userId, user.id),
            isNull(tasks.deletedAt),
          ),
        )
        .returning();
      if (!row) {
        set.status = 404;
        return { error: "Task not found" };
      }
      return { ok: true };
    },
    {
      params: t.Object({ id: t.String() }),
      detail: { tags: ["Tasks"], summary: "Soft-delete task" },
    },
  )
  .post(
    "/:id/thresholds",
    async ({ params, body, requireUser, set }) => {
      const user = requireUser();
      const task = await ownedTask(user.id, params.id);
      if (!task) {
        set.status = 404;
        return { error: "Task not found" };
      }
      const parsed = reminderThresholdSchema.safeParse({
        days_before: body.days_before,
      });
      if (!parsed.success) {
        set.status = 400;
        return {
          error: "Invalid threshold",
          fieldErrors: parsed.error.flatten().fieldErrors,
        };
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
        return { threshold: row };
      } catch {
        set.status = 400;
        return { error: "Threshold already exists for this day offset" };
      }
    },
    {
      params: t.Object({ id: t.String() }),
      body: t.Object({ days_before: t.Number() }),
      detail: { tags: ["Tasks"], summary: "Add reminder threshold" },
    },
  )
  .patch(
    "/:id/thresholds/:thresholdId",
    async ({ params, body, requireUser, set }) => {
      const user = requireUser();
      const task = await ownedTask(user.id, params.id);
      if (!task) {
        set.status = 404;
        return { error: "Task not found" };
      }
      const parsed = reminderThresholdSchema.safeParse({
        days_before: body.days_before,
      });
      if (!parsed.success) {
        set.status = 400;
        return {
          error: "Invalid threshold",
          fieldErrors: parsed.error.flatten().fieldErrors,
        };
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
      if (!row) {
        set.status = 404;
        return { error: "Threshold not found" };
      }
      return { threshold: row };
    },
    {
      params: t.Object({ id: t.String(), thresholdId: t.String() }),
      body: t.Object({ days_before: t.Number() }),
      detail: { tags: ["Tasks"], summary: "Update reminder threshold" },
    },
  )
  .delete(
    "/:id/thresholds/:thresholdId",
    async ({ params, requireUser, set }) => {
      const user = requireUser();
      const task = await ownedTask(user.id, params.id);
      if (!task) {
        set.status = 404;
        return { error: "Task not found" };
      }
      const [row] = await getDb()
        .delete(reminderThresholds)
        .where(
          and(
            eq(reminderThresholds.id, params.thresholdId),
            eq(reminderThresholds.taskId, task.id),
          ),
        )
        .returning();
      if (!row) {
        set.status = 404;
        return { error: "Threshold not found" };
      }
      return { ok: true };
    },
    {
      params: t.Object({ id: t.String(), thresholdId: t.String() }),
      detail: { tags: ["Tasks"], summary: "Remove reminder threshold" },
    },
  );
