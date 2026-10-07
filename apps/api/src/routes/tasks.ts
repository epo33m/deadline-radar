import { and, asc, count, desc, eq, gt, gte, inArray, isNull, lt, or } from "drizzle-orm";
import { Elysia, t } from "elysia";
import {
  MAX_ACTIVE_TASKS_PER_USER,
  MAX_THRESHOLDS_PER_TASK,
  thresholdTriggerAt,
} from "@deadline-radar/domain";
import {
  reminderThresholdSchema,
  reminderThresholdsPutSchema,
  taskPatchSchema,
  taskSchema,
} from "@deadline-radar/validation";
import {
  attachments,
  courses,
  profiles,
  reminderThresholds,
  tasks,
} from "@deadline-radar/db";

import { requireAuthPlugin } from "../plugins/auth";
import { getDb } from "../lib/db";
import {
  assertNoForbiddenMutationKeys,
  ownedCourse,
  ownedCourseInTx,
  ownedTask,
  ownedTaskInTx,
  withUserRls,
} from "../lib/authorization";
import {
  ApiError,
  apiDoc,
  beginIdempotent,
  completeIdempotent,
  completeIdempotentInTx,
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
  runTxWithCompletionRetry,
  secured,
  serializeAttachment,
  serializeCourse,
  serializeTask,
  serializeTaskList,
  serializeThreshold,
  validationFromZod,
  jsonBodyDetail,
  openApiBodies,
} from "../lib/api";

const ALLOWED_TASK_SORT = new Set(["deadline", "createdAt"]);

/**
 * Optional half-open deadline window `[dueFrom, dueTo)` for range-scoped
 * reads (calendar month view). Served by `idx_tasks_user_deadline_id_active`.
 */
function parseDeadlineBound(
  raw: unknown,
  field: "dueFrom" | "dueTo",
): Date | undefined {
  if (raw == null || raw === "") return undefined;
  const ms = new Date(String(raw)).getTime();
  if (Number.isNaN(ms)) {
    throw ApiError.validation("Invalid date range", [
      { field, message: "Must be an ISO-8601 datetime" },
    ]);
  }
  return new Date(ms);
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

/** Standard default offsets — those may exist even when already past (kept but skipped, DOMAIN.md §4). */
const DEFAULT_REMINDER_OFFSETS = [7, 3, 1, 0];

/** I-07: fetch the loop-invariant profile timezone once per request, outside
 * the write tx (shorter hold, no extra pool connection mid-transaction). */
async function resolveTaskTimezone(userId: string): Promise<string | null> {
  const [profile] = await getDb()
    .select({ timezone: profiles.timezone })
    .from(profiles)
    .where(eq(profiles.id, userId))
    .limit(1);
  return profile?.timezone ?? null;
}

/** Reject non-default thresholds whose trigger instant is already in the past (DOMAIN.md §4). */
async function assertThresholdNotInPast(
  task: { userId: string; deadline: Date },
  daysBefore: number,
  timezone: string | null,
): Promise<void> {
  if (DEFAULT_REMINDER_OFFSETS.includes(daysBefore)) return;
  const trigger = thresholdTriggerAt(
    task.deadline.toISOString(),
    daysBefore,
    timezone ?? "UTC",
  );
  if (Number.isNaN(trigger.getTime()) || Date.now() >= trigger.getTime()) {
    throw ApiError.validation("Reminder time has already passed", [
      {
        field: "days_before",
        message: "Pick a smaller number of days so the reminder is still ahead",
      },
    ]);
  }
}

function isUniqueViolation(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const e = error as Record<string, unknown>;
  if (e.code === "23505") return true;
  if (
    e.cause &&
    typeof e.cause === "object" &&
    (e.cause as Record<string, unknown>).code === "23505"
  ) {
    return true;
  }
  const message = typeof e.message === "string" ? e.message : "";
  return (
    message.includes("23505") ||
    message.includes("duplicate key value violates unique constraint")
  );
}

export const taskRoutes = new Elysia({ prefix: "/api/v1/tasks" })
  .use(requireAuthPlugin)
  .get(
    "/",
    async ({ requireAuthz, query }) => {
      const ctx = await requireAuthz("task.view");
      const { limit, cursor } = parsePaginationQuery({
        limit: query.limit,
        cursor: query.cursor,
      });
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
      const dueFrom = parseDeadlineBound(query.dueFrom, "dueFrom");
      const dueTo = parseDeadlineBound(query.dueTo, "dueTo");
      if (dueFrom && dueTo && dueFrom > dueTo) {
        throw ApiError.validation("Invalid date range", [
          { field: "dueFrom", message: "Must not be after dueTo" },
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
          deadline: tasks.deadline,
          status: tasks.status,
          createdAt: tasks.createdAt,
          updatedAt: tasks.updatedAt,
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
            query.courseId ? eq(tasks.courseId, query.courseId) : undefined,
            dueFrom ? gte(tasks.deadline, dueFrom) : undefined,
            dueTo ? lt(tasks.deadline, dueTo) : undefined,
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
        tasks: pageRows.map(serializeTaskList),
        page: pageMeta(limit, nextCursor),
      };
    },
    {
      query: t.Object({
        limit: t.Optional(t.String()),
        cursor: t.Optional(t.String()),
        sort: t.Optional(t.String()),
        courseId: t.Optional(t.String({ format: "uuid" })),
        dueFrom: t.Optional(t.String()),
        dueTo: t.Optional(t.String()),
      }),
      detail: {
        tags: ["Tasks"],
        summary: "List active tasks",
        ...secured(),
        ...apiDoc({
          ok: envelope(
            {
              tasks: { type: "array", items: R("TaskWithCourse") },
              page: R("Page"),
            },
            ["tasks", "page"],
          ),
          errors: [400, 401, 403, 429],
        }),
      },
    },
  )
  .get(
    "/:id",
    async ({ params, requireAuthz }) => {
      const ctx = await requireAuthz("task.view");
      const task = await ownedTask(ctx.subject.id, params.id);
      if (!task) throw ApiError.notFound("Task not found");
      // Ownership is proven by the ownedTask gate above. The three reads
      // below are independent (course/thresholds/attachments share no data
      // dependencies), so fan them out over the pool with Promise.all.
      // NOTE: deliberately not wrapped in a single withUserRls transaction:
      // postgres.js gives one tx a single reserved connection, so concurrent
      // queries inside it would serialize and gain nothing while paying
      // BEGIN + set_config overhead.
      const db = getDb();
      const [courseRows, thresholds, files] = await Promise.all([
        db
          .select()
          .from(courses)
          .where(and(eq(courses.id, task.courseId), isNull(courses.deletedAt)))
          .limit(1),
        db
          .select()
          .from(reminderThresholds)
          .where(
            and(
              eq(reminderThresholds.taskId, task.id),
              isNull(reminderThresholds.deletedAt),
            ),
          )
          .orderBy(asc(reminderThresholds.daysBefore)),
        db.select().from(attachments).where(eq(attachments.taskId, task.id)),
      ]);
      const course = courseRows[0];
      return {
        task: serializeTask(task),
        course: course ? serializeCourse(course) : null,
        thresholds: thresholds.map(serializeThreshold),
        attachments: files.map(serializeAttachment),
      };
    },
    {
      params: t.Object({ id: t.String({ format: "uuid" }) }),
      detail: {
        tags: ["Tasks"],
        summary: "Get task detail",
        ...secured(),
        ...apiDoc({
          ok: envelope(
            {
              task: R("Task"),
              course: { ...R("Course"), nullable: true },
              thresholds: { type: "array", items: R("Threshold") },
              attachments: { type: "array", items: R("Attachment") },
            },
            ["task", "course", "thresholds", "attachments"],
          ),
          errors: [401, 403, 404, 429],
        }),
      },
    },
  )
  .post(
    "/",
    async ({ requireAuthz, request, set }) => {
      const ctx = await requireAuthz("task.create");
      const body = await readJsonBody(request);
      assertNoForbiddenMutationKeys(body);

      // #136: everything that can answer 4xx runs BEFORE the claim, so a
      // rejected request never poisons the key (mirrors admin.ts ordering).
      const parsed = taskSchema.safeParse(body);
      if (!parsed.success) {
        throw validationFromZod(
          "Invalid task details",
          parsed.error.flatten().fieldErrors,
        );
      }

      const course = await ownedCourse(ctx.subject.id, parsed.data.course_id);
      if (!course) throw ApiError.validation("Course not found");

      // SEC-003: creation-time quota. Counted after ownership so error
      // precedence (validation → ownership → quota) is preserved. Count and
      // insert race under concurrency; overshoot is bounded by rate limiting
      // and idempotency, and the cron per-user send cap bounds spend anyway.
      const [quotaRow] = await getDb()
        .select({ value: count() })
        .from(tasks)
        .where(
          and(
            eq(tasks.userId, ctx.subject.id),
            isNull(tasks.deletedAt),
          ),
        )
        .limit(1);
      if ((quotaRow?.value ?? 0) >= MAX_ACTIVE_TASKS_PER_USER) {
        throw ApiError.rateLimited(
          `Task limit reached (${MAX_ACTIVE_TASKS_PER_USER} active tasks). Archive or delete old tasks first.`,
        );
      }

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

      // #137: insert + completion commit atomically, so a failing
      // completion can never leave a committed-but-uncompletable row behind.
      // A rolled-back transaction committed nothing, so the bounded retry on
      // unexpected failures cannot duplicate the task (I-02 preserved).
      let response: {
        task: ReturnType<typeof serializeTask>;
        redirectTo: string;
      };
      try {
        response = await runTxWithCompletionRetry(
          () =>
            withUserRls(ctx.subject.id, async (tx) => {
              const [row] = await tx
                .insert(tasks)
                .values({
                  userId: ctx.subject.id,
                  courseId: parsed.data.course_id,
                  title: parsed.data.title,
                  description: parsed.data.description,
                  deadline: new Date(parsed.data.deadline),
                  status: parsed.data.status,
                  // Terminal Done: creation accepts only active statuses, so a new
                  // task is never completed at birth (DOMAIN.md §2.3).
                  completedAt: null,
                  idempotencyKey: idemKey,
                })
                .returning();
              const res = {
                task: serializeTask(row),
                redirectTo: `/tasks/${row.id}`,
              };
              if (idemKey) {
                await completeIdempotentInTx(tx, {
                  userId: ctx.subject.id,
                  key: idemKey,
                  statusCode: 200,
                  body: res,
                });
              }
              return res;
            }),
          { key: idemKey },
        );
      } catch (error) {
        if (isUniqueViolation(error) && idemKey) {
          // #137 Layer B: a stale-reclaim re-execution found the committed
          // row via the dedupe key — replay it instead of duplicating.
          const [existing] = await getDb()
            .select()
            .from(tasks)
            .where(
              and(
                eq(tasks.userId, ctx.subject.id),
                eq(tasks.idempotencyKey, idemKey),
              ),
            )
            .limit(1);
          if (existing) {
            const replay = {
              task: serializeTask(existing),
              redirectTo: `/tasks/${existing.id}`,
            };
            await completeIdempotent({
              userId: ctx.subject.id,
              key: idemKey,
              statusCode: 200,
              body: replay,
            });
            return replay;
          }
        }
        // #136: a 4xx after the claim frees it for a corrected same-key retry.
        await releaseIdempotentOnClientError(error, {
          userId: ctx.subject.id,
          key: idemKey,
        });
        throw error;
      }
      return response;
    },
    {
      detail: {
        tags: ["Tasks"],
        summary: "Create task",
        requestBody: jsonBodyDetail(openApiBodies.taskCreate),
        ...secured(),
        ...apiDoc({
          ok: envelope(
            { task: R("Task"), redirectTo: { type: "string" } },
            ["task", "redirectTo"],
          ),
          errors: [400, 401, 403, 404, 409, 429],
        }),
        ...idempotent(),
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
      // Single withUserRls transaction for check + mutate + re-read (P2-3):
      // one BEGIN + set_config instead of up to three (owned check, optional
      // course check, conditional freshness re-check).
      return withUserRls(ctx.subject.id, async (tx) => {
        const existing = await ownedTaskInTx(tx, ctx.subject.id, params.id);
        if (!existing) throw ApiError.notFound("Task not found");

        // Terminal Done (DOMAIN.md §2.3): completed tasks are read-only and
        // can never be reopened. Checked before the freshness guard — terminal
        // state is the more fundamental conflict. Soft-delete (DELETE) and the
        // idempotent complete endpoint stay available.
        if (existing.status === "done") {
          throw ApiError.conflict("Task is completed and read-only", [
            {
              field: "status",
              message: "Completed tasks cannot be edited or reopened",
            },
          ]);
        }

        const clientUpdatedAt = parsed.data.updatedAt ?? parsed.data.updated_at;
        assertFreshUpdatedAt(
          existing.updatedAt,
          clientUpdatedAt,
        );

        const updates: Record<string, unknown> = {};
        if (parsed.data.title !== undefined) updates.title = parsed.data.title;
        if (parsed.data.description !== undefined)
          updates.description = parsed.data.description;
        if (parsed.data.deadline !== undefined) {
          updates.deadline = new Date(parsed.data.deadline);
          // F-01: only deadline edits advance the reminder edit-guard clock.
          // Unrelated edits must leave it alone, or due reminders would be
          // wrongly suppressed by the evaluator (DOMAIN.md §4).
          updates.deadlineUpdatedAt = new Date();
        }
        if (parsed.data.status !== undefined) {
          updates.status = parsed.data.status;
          // `existing` is never done here (terminal guard above), so a
          // transition to done always stamps a fresh completedAt.
          updates.completedAt =
            parsed.data.status === "done" ? new Date() : null;
        }
        if (parsed.data.course_id !== undefined) {
          const course = await ownedCourseInTx(
            tx,
            ctx.subject.id,
            parsed.data.course_id,
          );
          if (!course) throw ApiError.validation("Course not found");
          updates.courseId = parsed.data.course_id;
        }

        if (Object.keys(updates).length === 0) {
          throw ApiError.validation(
            "At least one field must be provided to update",
          );
        }

        updates.updatedAt = new Date();

        const [row] = await tx
          .update(tasks)
          .set(updates)
          .where(
            and(
              eq(tasks.id, params.id),
              eq(tasks.userId, ctx.subject.id),
              isNull(tasks.deletedAt),
              clientUpdatedAt
                ? eq(tasks.updatedAt, new Date(existing.updatedAt))
                : undefined,
            ),
          )
          .returning();
        if (!row) {
          const check = await ownedTaskInTx(tx, ctx.subject.id, params.id);
          if (check && clientUpdatedAt) {
            throw ApiError.conflict("Resource was modified; refresh and retry", [
              { field: "updatedAt", message: "Stale updatedAt" },
            ]);
          }
          throw ApiError.notFound("Task not found");
        }
        return { task: serializeTask(row) };
      });
    },
    {
      params: t.Object({ id: t.String({ format: "uuid" }) }),
      detail: {
        tags: ["Tasks"],
        summary: "Update task",
        requestBody: jsonBodyDetail(openApiBodies.taskPatch),
        ...secured(),
        ...apiDoc({
          ok: envelope({ task: R("Task") }, ["task"]),
          errors: [400, 401, 403, 404, 409, 429],
        }),
      },
    },
  )
  .post(
    "/:id/complete",
    async ({ params, requireAuthz }) => {
      const ctx = await requireAuthz("task.update");
      // Check + mutate in one transaction (P2-3).
      return withUserRls(ctx.subject.id, async (tx) => {
        const existing = await ownedTaskInTx(tx, ctx.subject.id, params.id);
        if (!existing) throw ApiError.notFound("Task not found");
        if (existing.status === "done") {
          return { task: serializeTask(existing) };
        }
        const [row] = await tx
          .update(tasks)
          .set({ status: "done", completedAt: new Date(), updatedAt: new Date() })
          .where(and(eq(tasks.id, params.id), eq(tasks.userId, ctx.subject.id)))
          .returning();
        return { task: serializeTask(row) };
      });
    },
    {
      params: t.Object({ id: t.String({ format: "uuid" }) }),
      detail: {
        tags: ["Tasks"],
        summary: "Mark task done",
        ...secured(),
        ...apiDoc({
          ok: envelope({ task: R("Task") }, ["task"]),
          errors: [401, 403, 404, 429],
        }),
      },
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
      detail: {
        tags: ["Tasks"],
        summary: "Soft-delete task",
        ...secured(),
        ...apiDoc({
          ok: envelope({ ok: { type: "boolean" } }, ["ok"]),
          errors: [401, 403, 404, 429],
        }),
      },
    },
  )
  .post(
    "/:id/thresholds",
    async ({ params, requireAuthz, request, set }) => {
      const ctx = await requireAuthz("threshold.manage");
      const body = await readJsonBody(request);
      assertNoForbiddenMutationKeys(body);

      // #136: parse before claiming so an invalid body never poisons the key.
      const parsed = reminderThresholdSchema.safeParse(body);
      if (!parsed.success) {
        throw validationFromZod(
          "Invalid threshold",
          parsed.error.flatten().fieldErrors,
        );
      }

      const taskId = params.id;
      const daysBefore = parsed.data.days_before;

      // I-07: loop-invariant profile read once, outside the write tx.
      // Default offsets skip the lookup entirely (unchanged behavior).
      const timezone = DEFAULT_REMINDER_OFFSETS.includes(daysBefore)
        ? null
        : await resolveTaskTimezone(ctx.subject.id);

      // RF-06: threshold POST is replayable with an Idempotency-Key, matching
      // task create. A double submit then returns the original response
      // instead of a bare 409.
      const idemKey = readIdempotencyKey(request);
      if (idemKey) {
        const { replay } = await beginIdempotent({
          userId: ctx.subject.id,
          key: idemKey,
          method: "POST",
          path: `/api/v1/tasks/${params.id}/thresholds`,
          body,
        });
        if (replay) {
          set.status = replay.statusCode;
          return replay.body;
        }
      }

      let response: { threshold: ReturnType<typeof serializeThreshold> };
      try {
        // Check + guard + count + insert + idempotency completion in one
        // transaction (P2-3, #137). A rolled-back transaction committed
        // nothing, so the bounded retry on unexpected failures cannot
        // duplicate the threshold (I-02 preserved).
        response = await runTxWithCompletionRetry(
          () =>
            withUserRls(ctx.subject.id, async (tx) => {
              const task = await ownedTaskInTx(tx, ctx.subject.id, taskId);
              if (!task) throw ApiError.notFound("Task not found");
              await assertThresholdNotInPast(task, daysBefore, timezone);
              // SEC-003: bound thresholds per task (each due threshold is an email).
              const [thresholdQuota] = await tx
                .select({ value: count() })
                .from(reminderThresholds)
                .where(
                  and(
                    eq(reminderThresholds.taskId, task.id),
                    isNull(reminderThresholds.deletedAt),
                  ),
                )
                .limit(1);
              if ((thresholdQuota?.value ?? 0) >= MAX_THRESHOLDS_PER_TASK) {
                throw ApiError.rateLimited(
                  `Reminder limit reached (${MAX_THRESHOLDS_PER_TASK} per task).`,
                );
              }
              const [row] = await tx
                .insert(reminderThresholds)
                .values({
                  taskId: task.id,
                  daysBefore,
                  isDefault: false,
                  idempotencyKey: idemKey,
                })
                .returning();
              const res = { threshold: serializeThreshold(row) };
              if (idemKey) {
                await completeIdempotentInTx(tx, {
                  userId: ctx.subject.id,
                  key: idemKey,
                  statusCode: 200,
                  body: res,
                });
              }
              return res;
            }),
          { key: idemKey },
        );
      } catch (error) {
        if (!isUniqueViolation(error)) {
          // #136: 404/400/429 from the tx free the claim for a corrected retry.
          await releaseIdempotentOnClientError(error, {
            userId: ctx.subject.id,
            key: idemKey,
          });
          throw error;
        }
        // RF-06: the offset already exists — the request's intent is already
        // satisfied, so return the existing threshold as success. The failed
        // transaction rolled back, so re-read on a fresh connection. #137:
        // prefer the dedupe-key lookup so a stale-reclaim re-execution
        // replays its own committed row even if the offset collides.
        const [existing] = idemKey
          ? await getDb()
              .select()
              .from(reminderThresholds)
              .where(
                and(
                  eq(reminderThresholds.taskId, taskId),
                  eq(reminderThresholds.idempotencyKey, idemKey),
                  isNull(reminderThresholds.deletedAt),
                ),
              )
              .limit(1)
          : [undefined];
        const [byOffset] =
          existing
            ? [existing]
            : await getDb()
                .select()
                .from(reminderThresholds)
                .where(
                  and(
                    eq(reminderThresholds.taskId, taskId),
                    eq(reminderThresholds.daysBefore, daysBefore),
                    isNull(reminderThresholds.deletedAt),
                  ),
                )
                .limit(1);
        if (!byOffset) {
          const conflict = ApiError.conflict(
            "Threshold already exists for this day offset",
          );
          await releaseIdempotentOnClientError(conflict, {
            userId: ctx.subject.id,
            key: idemKey,
          });
          throw conflict;
        }
        response = { threshold: serializeThreshold(byOffset) };
        // The rolled-back tx never recorded the completion — do it here.
        if (idemKey) {
          await completeIdempotent({
            userId: ctx.subject.id,
            key: idemKey,
            statusCode: 200,
            body: response,
          });
        }
      }
      return response;
    },
    {
      params: t.Object({ id: t.String({ format: "uuid" }) }),
      detail: {
        tags: ["Tasks"],
        summary: "Add reminder threshold",
        requestBody: jsonBodyDetail(openApiBodies.threshold),
        ...secured(),
        ...apiDoc({
          ok: envelope({ threshold: R("Threshold") }, ["threshold"]),
          errors: [400, 401, 403, 404, 429],
        }),
        ...idempotent(),
      },
    },
  )
  .put(
    "/:id/thresholds",
    async ({ params, requireAuthz, request }) => {
      const ctx = await requireAuthz("threshold.manage");
      const body = await readJsonBody(request);
      assertNoForbiddenMutationKeys(body);
      const parsed = reminderThresholdsPutSchema.safeParse(body);
      if (!parsed.success) {
        throw validationFromZod(
          "Invalid thresholds payload",
          parsed.error.flatten().fieldErrors,
        );
      }
      // SEC-003: PUT replaces the whole set — bound payload size in the
      // route (keeps validation free of domain coupling).
      if (parsed.data.thresholds.length > MAX_THRESHOLDS_PER_TASK) {
        throw ApiError.rateLimited(
          `Reminder limit reached (${MAX_THRESHOLDS_PER_TASK} per task).`,
        );
      }

      // I-07: loop-invariant profile read once, outside the write tx —
      // N thresholds share one query instead of N. All-default payloads
      // skip the lookup entirely (unchanged behavior).
      const timezone = parsed.data.thresholds.some(
        (item) => !DEFAULT_REMINDER_OFFSETS.includes(item.days_before),
      )
        ? await resolveTaskTimezone(ctx.subject.id)
        : null;

      // Check + replace-all in ONE withUserRls transaction (P2-3): previously
      // an ownedTask check tx followed by a separate db.transaction.
      const result = await withUserRls(ctx.subject.id, async (tx) => {
        const task = await ownedTaskInTx(tx, ctx.subject.id, params.id);
        if (!task) throw ApiError.notFound("Task not found");

        for (const item of parsed.data.thresholds) {
          await assertThresholdNotInPast(task, item.days_before, timezone);
        }

        const desiredOffsets = parsed.data.thresholds.map((t) => t.days_before);
        const desiredSet = new Set(desiredOffsets);

        const [txTask] = await tx
          .select({ id: tasks.id })
          .from(tasks)
          .where(
            and(
              eq(tasks.id, params.id),
              eq(tasks.userId, ctx.subject.id),
              isNull(tasks.deletedAt),
            ),
          )
          .for("update")
          .limit(1);
        if (!txTask) throw ApiError.notFound("Task not found");

        const existing = await tx
          .select()
          .from(reminderThresholds)
          .where(
            and(
              eq(reminderThresholds.taskId, task.id),
              isNull(reminderThresholds.deletedAt),
            ),
          );

        const existingByOffset = new Map(
          existing.map((e) => [e.daysBefore, e]),
        );

        // RF-09: removals archive (never hard-delete) so delivery history and
        // the in_app inbox survive. Archived offsets no longer block re-adding
        // the same offset (partial unique index is over live rows only).
        const toArchiveIds = existing
          .filter((e) => !desiredSet.has(e.daysBefore))
          .map((e) => e.id);

        if (toArchiveIds.length > 0) {
          await tx
            .update(reminderThresholds)
            .set({ deletedAt: new Date() })
            .where(inArray(reminderThresholds.id, toArchiveIds));
        }

        const toInsert = desiredOffsets.filter(
          (offset) => !existingByOffset.has(offset),
        );
        if (toInsert.length > 0) {
          await tx.insert(reminderThresholds).values(
            toInsert.map((offset) => ({
              taskId: task.id,
              daysBefore: offset,
              isDefault: DEFAULT_REMINDER_OFFSETS.includes(offset),
            })),
          );
        }

        const rows = await tx
          .select()
          .from(reminderThresholds)
          .where(
            and(
              eq(reminderThresholds.taskId, task.id),
              isNull(reminderThresholds.deletedAt),
            ),
          )
          .orderBy(asc(reminderThresholds.daysBefore));

        return rows;
      });

      return { thresholds: result.map(serializeThreshold) };
    },
    {
      params: t.Object({ id: t.String({ format: "uuid" }) }),
      detail: {
        tags: ["Tasks"],
        summary: "Set task reminder thresholds (atomic replace)",
        requestBody: jsonBodyDetail(openApiBodies.thresholdsPut),
        ...secured(),
        ...apiDoc({
          ok: envelope(
            { thresholds: { type: "array", items: R("Threshold") } },
            ["thresholds"],
          ),
          errors: [400, 401, 403, 404, 429],
        }),
      },
    },
  )
  .patch(
    "/:id/thresholds/:thresholdId",
    async ({ params, requireAuthz, request }) => {
      const ctx = await requireAuthz("threshold.manage");
      const body = await readJsonBody(request);
      assertNoForbiddenMutationKeys(body);
      const parsed = reminderThresholdSchema.safeParse(body);
      if (!parsed.success) {
        throw validationFromZod(
          "Invalid threshold",
          parsed.error.flatten().fieldErrors,
        );
      }
      // I-07: loop-invariant profile read once, outside the write tx.
      // Default offsets skip the lookup entirely (unchanged behavior).
      const timezone = DEFAULT_REMINDER_OFFSETS.includes(
        parsed.data.days_before,
      )
        ? null
        : await resolveTaskTimezone(ctx.subject.id);

      // Check + mutate in one transaction (P2-3).
      return withUserRls(ctx.subject.id, async (tx) => {
        const task = await ownedTaskInTx(tx, ctx.subject.id, params.id);
        if (!task) throw ApiError.notFound("Task not found");
        await assertThresholdNotInPast(task, parsed.data.days_before, timezone);
        try {
          const [row] = await tx
            .update(reminderThresholds)
            .set({
              daysBefore: parsed.data.days_before,
              isDefault: DEFAULT_REMINDER_OFFSETS.includes(
                parsed.data.days_before,
              ),
              // F-01: offset edits advance the per-threshold edit-guard clock
              // so newly-past default thresholds are skipped, not fired.
              updatedAt: new Date(),
            })
            .where(
              and(
                eq(reminderThresholds.id, params.thresholdId),
                eq(reminderThresholds.taskId, task.id),
                isNull(reminderThresholds.deletedAt),
              ),
            )
            .returning();
          if (!row) throw ApiError.notFound("Threshold not found");
          return { threshold: serializeThreshold(row) };
        } catch (error) {
          if (isUniqueViolation(error)) {
            throw ApiError.conflict(
              "Threshold already exists for this day offset",
            );
          }
          throw error;
        }
      });
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
        ...secured(),
        ...apiDoc({
          ok: envelope({ threshold: R("Threshold") }, ["threshold"]),
          errors: [400, 401, 403, 404, 409, 429],
        }),
      },
    },
  )
  .delete(
    "/:id/thresholds/:thresholdId",
    async ({ params, requireAuthz }) => {
      const ctx = await requireAuthz("threshold.manage");
      // RF-09: "remove" archives (UPDATE deleted_at) instead of hard-deleting,
      // so the cascade never wipes delivery history / the in_app inbox.
      return withUserRls(ctx.subject.id, async (tx) => {
        const task = await ownedTaskInTx(tx, ctx.subject.id, params.id);
        if (!task) throw ApiError.notFound("Task not found");
        const [row] = await tx
          .update(reminderThresholds)
          .set({ deletedAt: new Date() })
          .where(
            and(
              eq(reminderThresholds.id, params.thresholdId),
              eq(reminderThresholds.taskId, task.id),
              isNull(reminderThresholds.deletedAt),
            ),
          )
          .returning();
        if (!row) throw ApiError.notFound("Threshold not found");
        return { ok: true };
      });
    },
    {
      params: t.Object({
        id: t.String({ format: "uuid" }),
        thresholdId: t.String({ format: "uuid" }),
      }),
      detail: {
        tags: ["Tasks"],
        summary: "Remove reminder threshold",
        ...secured(),
        ...apiDoc({
          ok: envelope({ ok: { type: "boolean" } }, ["ok"]),
          errors: [401, 403, 404, 429],
        }),
      },
    },
  );
