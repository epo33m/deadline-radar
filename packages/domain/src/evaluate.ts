/** Wall-clock parts of an instant in a given IANA timezone. */
function getZonedParts(date: Date, timeZone: string) {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  });
  const parts = Object.fromEntries(
    formatter
      .formatToParts(date)
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, part.value]),
  );
  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    hour: Number(parts.hour),
    minute: Number(parts.minute),
    second: Number(parts.second),
  };
}

/** Interpret the zoned wall-clock of `date` as if those digits were UTC. */
function zonedPartsAsUtcMs(date: Date, timeZone: string): number {
  const p = getZonedParts(date, timeZone);
  return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
}

/**
 * Convert a wall-clock datetime in `timeZone` to a UTC Date.
 * Iterates to settle DST / offset around the target instant.
 */
function fromZonedTime(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  second: number,
  timeZone: string,
): Date {
  const desiredAsUtc = Date.UTC(year, month - 1, day, hour, minute, second);
  let guess = desiredAsUtc;
  for (let i = 0; i < 3; i += 1) {
    const offset = zonedPartsAsUtcMs(new Date(guess), timeZone) - guess;
    guess = desiredAsUtc - offset;
  }
  return new Date(guess);
}

/**
 * Threshold H-N fires at `deadline − N calendar days`, keeping the deadline's
 * local time of day in the profile timezone (DOMAIN.md §4).
 */
export function thresholdTriggerAt(
  deadlineIso: string,
  daysBefore: number,
  timeZone: string,
): Date {
  const deadline = new Date(deadlineIso);
  if (Number.isNaN(deadline.getTime())) {
    return new Date(NaN);
  }
  const parts = getZonedParts(deadline, timeZone);
  // Subtract days via UTC date math on calendar components (no DST skew on the day count).
  const shifted = new Date(
    Date.UTC(parts.year, parts.month - 1, parts.day - daysBefore),
  );
  return fromZonedTime(
    shifted.getUTCFullYear(),
    shifted.getUTCMonth() + 1,
    shifted.getUTCDate(),
    parts.hour,
    parts.minute,
    parts.second,
    timeZone,
  );
}

/** True when `now` is at or after the threshold trigger instant. */
export function isThresholdDue(
  deadlineIso: string,
  daysBefore: number,
  now: Date,
  timeZone: string,
): boolean {
  const trigger = thresholdTriggerAt(deadlineIso, daysBefore, timeZone);
  if (Number.isNaN(trigger.getTime())) return false;
  return now.getTime() >= trigger.getTime();
}

export const MAX_EMAIL_DELIVERY_RETRIES = 3;

/** RF-11: a reminder whose trigger is at least this stale is labeled "late"
 * (the scheduler was offline for a cycle). */
export const REMINDER_LATE_AFTER_MS = 60 * 60 * 1000;

/** RF-11: stop scheduling reminders once the deadline has been past for
 * longer than this grace, so a catch-up run cannot nag about overdue tasks.
 * The grace keeps the H-0 "today!" reminder deliverable in the first run
 * after the deadline (the scheduler is hourly). */
export const REMINDER_DEADLINE_GRACE_MS = 60 * 60 * 1000;

export type DeliveryChannel = "email" | "in_app";
export type DeliveryStatus = "pending" | "sending" | "sent" | "failed";

export type ReminderDeliveryInput = {
  id: string;
  threshold_id: string;
  days_before: number;
  channel: DeliveryChannel;
  status: DeliveryStatus;
  retry_count: number;
};

export type ReminderThresholdInput = {
  id: string;
  days_before: number;
  /** Last offset edit (or creation for never-edited rows). Thresholds whose
   * new trigger was already past at this instant are skipped (DOMAIN.md §4). */
  updated_at?: string;
  created_at?: string;
};

export type ReminderTaskInput = {
  id: string;
  status: "todo" | "in_progress" | "done";
  deadline: string;
  created_at: string;
  /** Last deadline edit (equals created_at for never-edited tasks).
   * Thresholds whose new trigger was already past at this instant are
   * skipped — the F-01 guard (DOMAIN.md §4). */
  deadline_updated_at?: string;
  timeZone: string;
  thresholds: ReminderThresholdInput[];
  deliveries: ReminderDeliveryInput[];
};

export type CreateDeliveryAction = {
  action: "create";
  task_id: string;
  threshold_id: string;
  channel: DeliveryChannel;
  days_before: number;
  /** RF-11: trigger was at least REMINDER_LATE_AFTER_MS stale at decision
   * time (scheduler catch-up). Frozen into the delivery on first attempt. */
  late: boolean;
};

/** Reuse the existing failed email row — never insert a duplicate channel row. */
export type RetryDeliveryAction = {
  action: "retry";
  delivery_id: string;
  task_id: string;
  threshold_id: string;
  channel: "email";
  days_before: number;
  retry_count: number;
};

export type EvaluateReminderAction = CreateDeliveryAction | RetryDeliveryAction;

/** First-run burst guard (F-03): thresholds that triggered before the
 * scheduler-activation instant are never fired, no matter how old the task
 * is. `null`/absent preserves the pre-existing behavior (no cutoff). */
export type EvaluateRemindersOptions = {
  cutoff?: Date | null;
};

/**
 * Decide create/retry actions for due thresholds.
 * - Skips `done` tasks.
 * - Skips thresholds whose trigger was already past at `created_at` (non-retroactive).
 * - Skips thresholds whose new trigger was already past at the last deadline
 *   or threshold-offset edit (F-01 guard, DOMAIN.md §4 "editing the deadline").
 * - Skips thresholds that triggered before `options.cutoff` (F-03 first-run
 *   burst guard). Applies to creates and retries alike.
 * - Skips channels that already have `pending`/`sending`/`sent` for the same
 *   (task, days_before, channel) — matched by offset, so an archived-then-
 *   re-added threshold does not re-send (RF-09/RF-10).
 * - Failed email → `retry` on the same delivery id (no duplicate create).
 */
export function evaluateReminders(
  tasks: ReminderTaskInput[],
  now: Date,
  options?: EvaluateRemindersOptions,
): EvaluateReminderAction[] {
  const actions: EvaluateReminderAction[] = [];
  const cutoffMs =
    options?.cutoff instanceof Date ? options.cutoff.getTime() : NaN;

  for (const task of tasks) {
    if (task.status === "done") continue;

    const createdAtMs = new Date(task.created_at).getTime();
    const deadlineEditedMs = task.deadline_updated_at
      ? new Date(task.deadline_updated_at).getTime()
      : createdAtMs;
    // RF-11: NaN deadline stays unsuppressed (F-12 invalid-timestamp path
    // already skips such tasks upstream).
    const deadlineMs = new Date(task.deadline).getTime();

    // Compute trigger once; due iff now is at/after that instant.
    for (const threshold of task.thresholds) {
      const trigger = thresholdTriggerAt(
        task.deadline,
        threshold.days_before,
        task.timeZone,
      );
      if (Number.isNaN(trigger.getTime()) || now.getTime() < trigger.getTime()) {
        continue;
      }

      // Non-retroactive: never fire thresholds that were already past at creation.
      if (trigger.getTime() < createdAtMs) {
        continue;
      }

      // F-01: never fire thresholds whose trigger (recomputed from the
      // current deadline/offset) was already past when the deadline or the
      // threshold offset was last edited. Unrelated task edits (title,
      // status, course) must NOT bump these timestamps, or legitimate due
      // reminders would be wrongly suppressed.
      const thresholdEditedMs = threshold.updated_at
        ? new Date(threshold.updated_at).getTime()
        : threshold.created_at
          ? new Date(threshold.created_at).getTime()
          : createdAtMs;
      const editCutoffMs = Math.max(
        Number.isNaN(deadlineEditedMs) ? createdAtMs : deadlineEditedMs,
        Number.isNaN(thresholdEditedMs) ? createdAtMs : thresholdEditedMs,
      );
      if (trigger.getTime() < editCutoffMs) {
        continue;
      }

      // F-03: first-run burst guard. Thresholds that triggered before the
      // scheduler-activation cutoff stay silent (creates and retries alike),
      // so enabling the scheduler over historical tasks cannot flood users
      // with stale reminders. Strict `<`: a trigger exactly at the cutoff
      // still fires.
      if (!Number.isNaN(cutoffMs) && trigger.getTime() < cutoffMs) {
        continue;
      }

      // RF-11: once the deadline is well past, stop scheduling this task's
      // reminders (creates and retries alike) — a catch-up run must not nag
      // about an overdue task. The 1h grace still lets H-0 fire in the first
      // hourly run after the deadline.
      if (
        !Number.isNaN(deadlineMs) &&
        now.getTime() > deadlineMs + REMINDER_DEADLINE_GRACE_MS
      ) {
        continue;
      }

      // RF-11: label catch-up sends; frozen into the body on first attempt.
      const late = now.getTime() - trigger.getTime() >= REMINDER_LATE_AFTER_MS;

      for (const channel of ["email", "in_app"] as const) {
        // RF-09/RF-10: delivery identity is (task, offset, channel), not the
        // threshold row. Thresholds are archived rather than deleted, and a
        // re-added offset gets a fresh threshold id — matching on
        // days_before+channel keeps an already-sent/pending offset suppressed
        // instead of re-sending it.
        const candidates = task.deliveries.filter(
          (d) =>
            d.days_before === threshold.days_before && d.channel === channel,
        );
        const live = candidates.find((d) => d.threshold_id === threshold.id);

        // pending/sending/sent rows suppress: a send is done, in flight, or
        // claimed by a run (F-10 atomic sweep claim) — even under an archived
        // threshold (RF-10).
        if (
          candidates.some(
            (d) =>
              d.status === "pending" ||
              d.status === "sending" ||
              d.status === "sent",
          )
        ) {
          continue;
        }

        // failed: email retries in place, but only the live threshold's own
        // row (an archived threshold's failed row must not be resurrected).
        // Cap cross-cycle scheduler retries to MAX_EMAIL_DELIVERY_RETRIES.
        if (
          channel === "email" &&
          live?.status === "failed" &&
          live.retry_count < MAX_EMAIL_DELIVERY_RETRIES
        ) {
          actions.push({
            action: "retry",
            delivery_id: live.id,
            task_id: task.id,
            threshold_id: threshold.id,
            channel: "email",
            days_before: threshold.days_before,
            retry_count: live.retry_count,
          });
          continue;
        }

        // A live failed row already at the retry cap: creating would violate
        // the unique (threshold_id, days_before, channel) index — suppress.
        if (live?.status === "failed") {
          continue;
        }

        // No delivery for this offset yet, or only an archived threshold's
        // failed row (never actually sent): create for the live threshold.
        actions.push({
          action: "create",
          task_id: task.id,
          threshold_id: threshold.id,
          channel,
          days_before: threshold.days_before,
          late,
        });
      }
    }
  }

  return actions;
}
