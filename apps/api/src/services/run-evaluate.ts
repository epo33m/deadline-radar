import { and, eq, inArray, isNull, ne } from "drizzle-orm";
import {
  evaluateReminders,
  type ReminderTaskInput,
} from "@deadline-radar/domain";
import {
  notificationDeliveries,
  profiles,
  reminderThresholds,
  tasks,
} from "@deadline-radar/db";

import { getDb } from "../lib/db";
import { sendReminderEmail } from "../lib/email";

export type EvaluateRemindersResult = {
  evaluatedTasks: number;
  created: number;
  retried: number;
  emailsSent: number;
  emailsFailed: number;
};

export async function runEvaluateReminders(
  now: Date = new Date(),
): Promise<EvaluateRemindersResult> {
  const db = getDb();
  const sentAt = now;

  const taskRows = await db
    .select({
      id: tasks.id,
      userId: tasks.userId,
      status: tasks.status,
      deadline: tasks.deadline,
      createdAt: tasks.createdAt,
      title: tasks.title,
    })
    .from(tasks)
    .where(and(ne(tasks.status, "done"), isNull(tasks.deletedAt)));

  if (taskRows.length === 0) {
    return {
      evaluatedTasks: 0,
      created: 0,
      retried: 0,
      emailsSent: 0,
      emailsFailed: 0,
    };
  }

  const taskIds = taskRows.map((t) => t.id);
  const userIds = [...new Set(taskRows.map((t) => t.userId))];

  const thresholdRows = await db
    .select()
    .from(reminderThresholds)
    .where(inArray(reminderThresholds.taskId, taskIds));

  const deliveryRows = await db
    .select()
    .from(notificationDeliveries)
    .where(inArray(notificationDeliveries.taskId, taskIds));

  const profileRows = await db
    .select({
      id: profiles.id,
      email: profiles.email,
      timezone: profiles.timezone,
    })
    .from(profiles)
    .where(inArray(profiles.id, userIds));

  const profileById = new Map(profileRows.map((p) => [p.id, p]));
  const thresholdsByTask = new Map<string, typeof thresholdRows>();
  for (const row of thresholdRows) {
    const list = thresholdsByTask.get(row.taskId) ?? [];
    list.push(row);
    thresholdsByTask.set(row.taskId, list);
  }
  const deliveriesByTask = new Map<string, typeof deliveryRows>();
  for (const row of deliveryRows) {
    const list = deliveriesByTask.get(row.taskId) ?? [];
    list.push(row);
    deliveriesByTask.set(row.taskId, list);
  }

  const inputs: ReminderTaskInput[] = taskRows.map((task) => {
    const profile = profileById.get(task.userId);
    return {
      id: task.id,
      status: task.status,
      deadline: task.deadline.toISOString(),
      created_at: task.createdAt.toISOString(),
      timeZone: profile?.timezone ?? "UTC",
      thresholds: (thresholdsByTask.get(task.id) ?? []).map((t) => ({
        id: t.id,
        days_before: t.daysBefore,
      })),
      deliveries: (deliveriesByTask.get(task.id) ?? []).map((d) => ({
        id: d.id,
        threshold_id: d.thresholdId,
        channel: d.channel,
        status: d.status,
        retry_count: d.retryCount,
      })),
    };
  });

  const actions = evaluateReminders(inputs, now);
  let created = 0;
  let retried = 0;
  let emailsSent = 0;
  let emailsFailed = 0;

  const emailWork: {
    deliveryId: string;
    taskId: string;
    daysBefore: number;
  }[] = [];

  for (const action of actions) {
    if (action.action === "create") {
      if (action.channel === "in_app") {
        await db.insert(notificationDeliveries).values({
          taskId: action.task_id,
          thresholdId: action.threshold_id,
          channel: "in_app",
          status: "sent",
          sentAt,
        });
        created += 1;
        continue;
      }

      const [inserted] = await db
        .insert(notificationDeliveries)
        .values({
          taskId: action.task_id,
          thresholdId: action.threshold_id,
          channel: "email",
          status: "pending",
        })
        .returning({ id: notificationDeliveries.id });
      created += 1;
      emailWork.push({
        deliveryId: inserted.id,
        taskId: action.task_id,
        daysBefore: action.days_before,
      });
      continue;
    }

    await db
      .update(notificationDeliveries)
      .set({
        status: "pending",
        retryCount: action.retry_count + 1,
      })
      .where(eq(notificationDeliveries.id, action.delivery_id));
    retried += 1;
    emailWork.push({
      deliveryId: action.delivery_id,
      taskId: action.task_id,
      daysBefore: action.days_before,
    });
  }

  async function markFailed(deliveryId: string, retryCount?: number) {
    await db
      .update(notificationDeliveries)
      .set({
        status: "failed",
        ...(retryCount != null ? { retryCount } : {}),
      })
      .where(eq(notificationDeliveries.id, deliveryId));
  }

  async function markSent(deliveryId: string) {
    await db
      .update(notificationDeliveries)
      .set({ status: "sent", sentAt })
      .where(eq(notificationDeliveries.id, deliveryId));
  }

  for (const work of emailWork) {
    const task = taskRows.find((t) => t.id === work.taskId);
    const to = task ? profileById.get(task.userId)?.email : null;
    if (!task || !to) {
      await markFailed(work.deliveryId);
      emailsFailed += 1;
      continue;
    }
    try {
      await sendReminderEmail({
        to,
        taskTitle: task.title,
        daysBefore: work.daysBefore,
        deadlineIso: task.deadline.toISOString(),
      });
      await markSent(work.deliveryId);
      emailsSent += 1;
    } catch {
      await markFailed(work.deliveryId);
      emailsFailed += 1;
    }
  }

  const queuedIds = new Set(emailWork.map((w) => w.deliveryId));
  const stuckPending = await db
    .select({
      id: notificationDeliveries.id,
      retryCount: notificationDeliveries.retryCount,
      taskId: notificationDeliveries.taskId,
      thresholdId: notificationDeliveries.thresholdId,
    })
    .from(notificationDeliveries)
    .where(
      and(
        eq(notificationDeliveries.channel, "email"),
        eq(notificationDeliveries.status, "pending"),
      ),
    );

  for (const row of stuckPending) {
    if (queuedIds.has(row.id)) continue;
    const task = taskRows.find((t) => t.id === row.taskId);
    const threshold = thresholdRows.find((t) => t.id === row.thresholdId);
    if (!task || !threshold || task.status === "done") continue;
    const to = profileById.get(task.userId)?.email;
    if (!to) {
      await markFailed(row.id);
      emailsFailed += 1;
      continue;
    }
    try {
      await sendReminderEmail({
        to,
        taskTitle: task.title,
        daysBefore: threshold.daysBefore,
        deadlineIso: task.deadline.toISOString(),
      });
      await markSent(row.id);
      emailsSent += 1;
    } catch {
      await markFailed(row.id, (row.retryCount ?? 0) + 1);
      emailsFailed += 1;
    }
  }

  return {
    evaluatedTasks: taskRows.length,
    created,
    retried,
    emailsSent,
    emailsFailed,
  };
}
