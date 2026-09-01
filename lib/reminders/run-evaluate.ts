import { sendReminderEmail } from "@/lib/email/resend";
import {
  evaluateReminders,
  type DeliveryChannel,
  type DeliveryStatus,
  type ReminderTaskInput,
} from "@/lib/reminders/evaluate";
import { createServiceClient } from "@/lib/supabase/service";

type ServiceClient = ReturnType<typeof createServiceClient>;

type TaskRow = {
  id: string;
  user_id: string;
  status: "todo" | "in_progress" | "done";
  deadline: string;
  created_at: string;
  title: string;
  reminder_thresholds: { id: string; days_before: number }[] | null;
  notification_deliveries:
    | {
        id: string;
        threshold_id: string;
        channel: DeliveryChannel;
        status: DeliveryStatus;
        retry_count: number;
      }[]
    | null;
};

type ProfileRow = {
  id: string;
  email: string;
  timezone: string;
};

export type EvaluateRemindersResult = {
  evaluatedTasks: number;
  created: number;
  retried: number;
  emailsSent: number;
  emailsFailed: number;
};

async function markEmailSent(
  supabase: ServiceClient,
  deliveryId: string,
  sentAt: string,
) {
  const { error } = await supabase
    .from("notification_deliveries")
    .update({ status: "sent", sent_at: sentAt })
    .eq("id", deliveryId);
  if (error) throw new Error(error.message);
}

async function markEmailFailed(
  supabase: ServiceClient,
  deliveryId: string,
  retryCount?: number,
) {
  const patch: { status: "failed"; retry_count?: number } = {
    status: "failed",
  };
  if (retryCount != null) patch.retry_count = retryCount;
  const { error } = await supabase
    .from("notification_deliveries")
    .update(patch)
    .eq("id", deliveryId);
  if (error) throw new Error(error.message);
}

async function deliverEmail(
  supabase: ServiceClient,
  args: {
    deliveryId: string;
    to: string;
    taskTitle: string;
    daysBefore: number;
    deadlineIso: string;
    sentAt: string;
    failRetryCount?: number;
  },
): Promise<"sent" | "failed"> {
  try {
    await sendReminderEmail({
      to: args.to,
      taskTitle: args.taskTitle,
      daysBefore: args.daysBefore,
      deadlineIso: args.deadlineIso,
    });
    await markEmailSent(supabase, args.deliveryId, args.sentAt);
    return "sent";
  } catch {
    await markEmailFailed(
      supabase,
      args.deliveryId,
      args.failRetryCount,
    );
    return "failed";
  }
}

async function resolveEmail(
  supabase: ServiceClient,
  profileById: Map<string, ProfileRow>,
  userId: string,
): Promise<string | null> {
  const cached = profileById.get(userId)?.email;
  if (cached) return cached;
  const { data } = await supabase
    .from("profiles")
    .select("email")
    .eq("id", userId)
    .maybeSingle();
  return data?.email ?? null;
}

export async function runEvaluateReminders(
  now: Date = new Date(),
): Promise<EvaluateRemindersResult> {
  const supabase = createServiceClient();
  const sentAt = now.toISOString();

  const { data: tasks, error: tasksError } = await supabase
    .from("tasks")
    .select(
      `
      id,
      user_id,
      status,
      deadline,
      created_at,
      title,
      reminder_thresholds ( id, days_before ),
      notification_deliveries ( id, threshold_id, channel, status, retry_count )
    `,
    )
    .neq("status", "done")
    .is("deleted_at", null);

  if (tasksError) {
    throw new Error(tasksError.message);
  }

  const taskRows = (tasks ?? []) as TaskRow[];
  const userIds = [...new Set(taskRows.map((t) => t.user_id))];

  const profileById = new Map<string, ProfileRow>();
  if (userIds.length > 0) {
    const { data: profiles, error: profilesError } = await supabase
      .from("profiles")
      .select("id, email, timezone")
      .in("id", userIds);
    if (profilesError) {
      throw new Error(profilesError.message);
    }
    for (const profile of (profiles ?? []) as ProfileRow[]) {
      profileById.set(profile.id, profile);
    }
  }

  const inputs: ReminderTaskInput[] = taskRows.map((task) => {
    const profile = profileById.get(task.user_id);
    return {
      id: task.id,
      status: task.status,
      deadline: task.deadline,
      created_at: task.created_at,
      timeZone: profile?.timezone ?? "UTC",
      thresholds: task.reminder_thresholds ?? [],
      deliveries: task.notification_deliveries ?? [],
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
        const { error } = await supabase.from("notification_deliveries").insert({
          task_id: action.task_id,
          threshold_id: action.threshold_id,
          channel: "in_app",
          status: "sent",
          sent_at: sentAt,
        });
        if (error) throw new Error(error.message);
        created += 1;
        continue;
      }

      const { data: inserted, error } = await supabase
        .from("notification_deliveries")
        .insert({
          task_id: action.task_id,
          threshold_id: action.threshold_id,
          channel: "email",
          status: "pending",
        })
        .select("id")
        .single();
      if (error) throw new Error(error.message);
      created += 1;
      emailWork.push({
        deliveryId: inserted.id,
        taskId: action.task_id,
        daysBefore: action.days_before,
      });
      continue;
    }

    // retry: reuse the existing failed email row — never insert a duplicate.
    const { error } = await supabase
      .from("notification_deliveries")
      .update({
        status: "pending",
        retry_count: action.retry_count + 1,
      })
      .eq("id", action.delivery_id);
    if (error) throw new Error(error.message);
    retried += 1;
    emailWork.push({
      deliveryId: action.delivery_id,
      taskId: action.task_id,
      daysBefore: action.days_before,
    });
  }

  for (const work of emailWork) {
    const task = taskRows.find((t) => t.id === work.taskId);
    const to = task
      ? await resolveEmail(supabase, profileById, task.user_id)
      : null;
    if (!task || !to) {
      await markEmailFailed(supabase, work.deliveryId);
      emailsFailed += 1;
      continue;
    }

    const outcome = await deliverEmail(supabase, {
      deliveryId: work.deliveryId,
      to,
      taskTitle: task.title,
      daysBefore: work.daysBefore,
      deadlineIso: task.deadline,
      sentAt,
    });
    if (outcome === "sent") emailsSent += 1;
    else emailsFailed += 1;
  }

  // Drain email rows left pending from a prior interrupted run.
  const queuedIds = new Set(emailWork.map((w) => w.deliveryId));
  const { data: stuckPending, error: stuckError } = await supabase
    .from("notification_deliveries")
    .select(
      `
      id,
      retry_count,
      reminder_thresholds ( days_before ),
      tasks ( title, deadline, user_id, status, deleted_at )
    `,
    )
    .eq("channel", "email")
    .eq("status", "pending");

  if (stuckError) throw new Error(stuckError.message);

  for (const row of stuckPending ?? []) {
    if (queuedIds.has(row.id)) continue;

    const taskRaw = row.tasks as
      | {
          title: string;
          deadline: string;
          user_id: string;
          status: string;
          deleted_at: string | null;
        }
      | {
          title: string;
          deadline: string;
          user_id: string;
          status: string;
          deleted_at: string | null;
        }[]
      | null;
    const thresholdRaw = row.reminder_thresholds as
      | { days_before: number }
      | { days_before: number }[]
      | null;

    const taskJoin = Array.isArray(taskRaw) ? (taskRaw[0] ?? null) : taskRaw;
    const thresholdJoin = Array.isArray(thresholdRaw)
      ? (thresholdRaw[0] ?? null)
      : thresholdRaw;

    if (!taskJoin || taskJoin.deleted_at || taskJoin.status === "done") {
      continue;
    }

    const daysBefore = thresholdJoin?.days_before;
    if (daysBefore == null) continue;

    const to = await resolveEmail(supabase, profileById, taskJoin.user_id);
    if (!to) {
      await markEmailFailed(supabase, row.id);
      emailsFailed += 1;
      continue;
    }

    const outcome = await deliverEmail(supabase, {
      deliveryId: row.id,
      to,
      taskTitle: taskJoin.title,
      daysBefore,
      deadlineIso: taskJoin.deadline,
      sentAt,
      failRetryCount: (row.retry_count ?? 0) + 1,
    });
    if (outcome === "sent") emailsSent += 1;
    else emailsFailed += 1;
  }

  return {
    evaluatedTasks: taskRows.length,
    created,
    retried,
    emailsSent,
    emailsFailed,
  };
}
