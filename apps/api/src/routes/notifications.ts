import { Elysia, t } from "elysia";
import { and, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { markNotificationReadSchema } from "@deadline-radar/validation";
import {
  notificationDeliveries,
  reminderThresholds,
  tasks,
} from "@deadline-radar/db";

import { requireAuthPlugin } from "../plugins/auth";
import { getDb } from "../lib/db";

export const notificationRoutes = new Elysia({ prefix: "/api/notifications" })
  .use(requireAuthPlugin)
  .get(
    "/",
    async ({ requireAuthz }) => {
      const ctx = await requireAuthz("notification.view");
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
          daysBefore: reminderThresholds.daysBefore,
        })
        .from(notificationDeliveries)
        .innerJoin(tasks, eq(notificationDeliveries.taskId, tasks.id))
        .innerJoin(
          reminderThresholds,
          eq(notificationDeliveries.thresholdId, reminderThresholds.id),
        )
        .where(
          and(
            eq(tasks.userId, ctx.subject.id),
            eq(notificationDeliveries.channel, "in_app"),
            eq(notificationDeliveries.status, "sent"),
            isNull(tasks.deletedAt),
          ),
        )
        .orderBy(desc(notificationDeliveries.sentAt));

      return { notifications: rows };
    },
    { detail: { tags: ["Notifications"], summary: "List in-app notifications" } },
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
    { detail: { tags: ["Notifications"], summary: "Unread count" } },
  )
  .post(
    "/:id/read",
    async ({ params, requireAuthz, set }) => {
      const ctx = await requireAuthz("notification.mark-read");
      const parsed = markNotificationReadSchema.safeParse({ id: params.id });
      if (!parsed.success) {
        set.status = 400;
        return { error: "Invalid notification id" };
      }

      const [owned] = await getDb()
        .select({ id: notificationDeliveries.id })
        .from(notificationDeliveries)
        .innerJoin(tasks, eq(notificationDeliveries.taskId, tasks.id))
        .where(
          and(
            eq(notificationDeliveries.id, parsed.data.id),
            eq(tasks.userId, ctx.subject.id),
          ),
        )
        .limit(1);

      if (!owned) {
        set.status = 404;
        return { error: "Notification not found" };
      }

      await getDb()
        .update(notificationDeliveries)
        .set({ readAt: new Date() })
        .where(eq(notificationDeliveries.id, owned.id));

      return { ok: true };
    },
    {
      params: t.Object({ id: t.String() }),
      detail: { tags: ["Notifications"], summary: "Mark one as read" },
    },
  )
  .post(
    "/read-all",
    async ({ requireAuthz }) => {
      const ctx = await requireAuthz("notification.mark-read");
      const owned = await getDb()
        .select({ id: notificationDeliveries.id })
        .from(notificationDeliveries)
        .innerJoin(tasks, eq(notificationDeliveries.taskId, tasks.id))
        .where(
          and(
            eq(tasks.userId, ctx.subject.id),
            eq(notificationDeliveries.channel, "in_app"),
            eq(notificationDeliveries.status, "sent"),
            isNull(notificationDeliveries.readAt),
          ),
        );

      if (owned.length > 0) {
        await getDb()
          .update(notificationDeliveries)
          .set({ readAt: new Date() })
          .where(
            inArray(
              notificationDeliveries.id,
              owned.map((o) => o.id),
            ),
          );
      }

      return { ok: true, updated: owned.length };
    },
    { detail: { tags: ["Notifications"], summary: "Mark all as read" } },
  );
