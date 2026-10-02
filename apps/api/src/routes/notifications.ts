import { and, desc, eq, inArray, isNull, lt, or, sql } from "drizzle-orm";
import { Elysia, t } from "elysia";
import { markNotificationReadSchema } from "@deadline-radar/validation";
import {
  notificationDeliveries,
  profiles,
  tasks,
} from "@deadline-radar/db";

import { requireAuthPlugin } from "../plugins/auth";
import { getDb } from "../lib/db";
import {
  ApiError,
  apiDoc,
  decodeCursor,
  encodeCursor,
  envelope,
  pageMeta,
  parsePaginationQuery,
  R,
  secured,
  serializeNotification,
  validationFromZod,
} from "../lib/api";

export const notificationRoutes = new Elysia({
  prefix: "/api/v1/notifications",
})
  .use(requireAuthPlugin)
  .get(
    "/",
    async ({ requireAuthz, query }) => {
      const ctx = await requireAuthz("notification.view");
      const { limit, cursor } = parsePaginationQuery({
        limit: query.limit,
        cursor: query.cursor,
      });
      const decoded = decodeCursor(cursor);

      const rows = await getDb()
        .select({
          id: notificationDeliveries.id,
          taskId: notificationDeliveries.taskId,
          thresholdId: notificationDeliveries.thresholdId,
          channel: notificationDeliveries.channel,
          status: notificationDeliveries.status,
          retryCount: notificationDeliveries.retryCount,
          sentAt: notificationDeliveries.sentAt,
          readAt: notificationDeliveries.readAt,
          createdAt: notificationDeliveries.createdAt,
          taskTitle: tasks.title,
          daysBefore: notificationDeliveries.daysBefore,
          // RF-11: derive the in-app "late" label on read from the live task
          // deadline and the profile timezone (no delivery-body snapshot for
          // in-app rows).
          taskDeadline: tasks.deadline,
          timeZone: profiles.timezone,
        })
        .from(notificationDeliveries)
        .innerJoin(tasks, eq(notificationDeliveries.taskId, tasks.id))
        .innerJoin(profiles, eq(profiles.id, tasks.userId))
        .where(
          and(
            eq(tasks.userId, ctx.subject.id),
            eq(notificationDeliveries.channel, "in_app"),
            eq(notificationDeliveries.status, "sent"),
            isNull(tasks.deletedAt),
            decoded
              ? or(
                  lt(notificationDeliveries.sentAt, new Date(decoded.k)),
                  and(
                    eq(notificationDeliveries.sentAt, new Date(decoded.k)),
                    lt(notificationDeliveries.id, decoded.id),
                  ),
                )
              : undefined,
          ),
        )
        .orderBy(desc(notificationDeliveries.sentAt), desc(notificationDeliveries.id))
        .limit(limit + 1);

      const pageRows = rows.slice(0, limit);
      const last = pageRows[pageRows.length - 1];
      const nextCursor =
        rows.length > limit && last?.sentAt
          ? encodeCursor({
              v: 1,
              k: new Date(last.sentAt).toISOString(),
              id: last.id,
            })
          : null;

      return {
        notifications: pageRows.map(serializeNotification),
        page: pageMeta(limit, nextCursor),
      };
    },
    {
      query: t.Object({
        limit: t.Optional(t.String()),
        cursor: t.Optional(t.String()),
      }),
      detail: {
        tags: ["Notifications"],
        summary: "List in-app notifications",
        ...secured(),
        ...apiDoc({
          ok: envelope(
            {
              notifications: { type: "array", items: R("NotificationItem") },
              page: R("Page"),
            },
            ["notifications", "page"],
          ),
          errors: [400, 401, 403, 429],
        }),
      },
    },
  )
  .get(
    "/unread-count",
    async ({ requireAuthz }) => {
      const ctx = await requireAuthz("notification.view");
      const [row] = await getDb()
        .select({
          count: sql<number>`count(*)::int`,
        })
        .from(notificationDeliveries)
        .innerJoin(tasks, eq(notificationDeliveries.taskId, tasks.id))
        .where(
          and(
            eq(tasks.userId, ctx.subject.id),
            eq(notificationDeliveries.channel, "in_app"),
            eq(notificationDeliveries.status, "sent"),
            isNull(notificationDeliveries.readAt),
            isNull(tasks.deletedAt),
          ),
        );
      return { count: row?.count ?? 0 };
    },
    {
      detail: {
        tags: ["Notifications"],
        summary: "Unread count",
        ...secured(),
        ...apiDoc({
          ok: envelope({ count: { type: "integer" } }, ["count"]),
          errors: [401, 403, 429],
        }),
      },
    },
  )
  .post(
    "/:id/read",
    async ({ params, requireAuthz }) => {
      const ctx = await requireAuthz("notification.mark-read");
      const parsed = markNotificationReadSchema.safeParse({ id: params.id });
      if (!parsed.success) {
        throw validationFromZod(
          "Invalid notification id",
          parsed.error.flatten().fieldErrors,
        );
      }

      // I-07: single conditional mutation — no separate ownership SELECT.
      // Ownership is enforced inside the statement (deliveries carry no
      // userId column, so scope through the parent task owned by the
      // requester); zero rows means missing, not-owned, or raced away, all
      // reported as the same generic 404 with no enumeration.
      const updated = await getDb()
        .update(notificationDeliveries)
        .set({ readAt: new Date() })
        .where(
          and(
            eq(notificationDeliveries.id, parsed.data.id),
            inArray(
              notificationDeliveries.taskId,
              getDb()
                .select({ id: tasks.id })
                .from(tasks)
                .where(
                  and(
                    eq(tasks.userId, ctx.subject.id),
                    isNull(tasks.deletedAt),
                  ),
                ),
            ),
          ),
        )
        .returning({ id: notificationDeliveries.id });
      if (updated.length === 0) {
        throw ApiError.notFound("Notification not found");
      }

      return { ok: true };
    },
    {
      params: t.Object({ id: t.String({ format: "uuid" }) }),
      detail: {
        tags: ["Notifications"],
        summary: "Mark one as read",
        ...secured(),
        ...apiDoc({
          ok: envelope({ ok: { type: "boolean" } }, ["ok"]),
          errors: [400, 401, 403, 404, 429],
        }),
      },
    },
  )
  .post(
    "/read-all",
    async ({ requireAuthz }) => {
      const ctx = await requireAuthz("notification.mark-read");
      // Single set-based statement: no notification ID list is loaded into
      // memory, so the operation stays bounded regardless of unread volume
      // (no bind-parameter blowup, no pagination drift). Ownership and
      // visibility are enforced inside the statement itself: only unread,
      // sent in-app deliveries of the requester's non-deleted tasks.
      const updated = await getDb()
        .update(notificationDeliveries)
        .set({ readAt: new Date() })
        .where(
          and(
            inArray(
              notificationDeliveries.taskId,
              getDb()
                .select({ id: tasks.id })
                .from(tasks)
                .where(
                  and(
                    eq(tasks.userId, ctx.subject.id),
                    isNull(tasks.deletedAt),
                  ),
                ),
            ),
            eq(notificationDeliveries.channel, "in_app"),
            eq(notificationDeliveries.status, "sent"),
            isNull(notificationDeliveries.readAt),
          ),
        )
        .returning({ id: notificationDeliveries.id });

      return { ok: true, updated: updated.length };
    },
    {
      detail: {
        tags: ["Notifications"],
        summary: "Mark all as read",
        ...secured(),
        ...apiDoc({
          ok: envelope(
            { ok: { type: "boolean" }, updated: { type: "integer" } },
            ["ok", "updated"],
          ),
          description:
            "Single set-based statement over the caller's visible " +
            "(non-deleted) unread notifications. `updated` counts rows " +
            "actually marked.",
          errors: [401, 403, 429],
        }),
      },
    },
  );
