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

export type DeliveryChannel = "email" | "in_app";
export type DeliveryStatus = "pending" | "sent" | "failed";

export type ReminderDeliveryInput = {
  id: string;
  threshold_id: string;
  channel: DeliveryChannel;
  status: DeliveryStatus;
  retry_count: number;
};

export type ReminderThresholdInput = {
  id: string;
  days_before: number;
};

export type ReminderTaskInput = {
  id: string;
  status: "todo" | "in_progress" | "done";
  deadline: string;
  created_at: string;
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

/**
 * Decide create/retry actions for due thresholds.
 * - Skips `done` tasks.
 * - Skips thresholds whose trigger was already past at `created_at` (non-retroactive).
 * - Skips channels that already have `pending` or `sent`.
 * - Failed email → `retry` on the same delivery id (no duplicate create).
 */
export function evaluateReminders(
  tasks: ReminderTaskInput[],
  now: Date,
): EvaluateReminderAction[] {
  const actions: EvaluateReminderAction[] = [];

  for (const task of tasks) {
    if (task.status === "done") continue;

    const createdAtMs = new Date(task.created_at).getTime();

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

      for (const channel of ["email", "in_app"] as const) {
        const existing = task.deliveries.find(
          (d) =>
            d.threshold_id === threshold.id && d.channel === channel,
        );

        if (!existing) {
          actions.push({
            action: "create",
            task_id: task.id,
            threshold_id: threshold.id,
            channel,
            days_before: threshold.days_before,
          });
          continue;
        }

        if (existing.status === "pending" || existing.status === "sent") {
          continue;
        }

        // failed: email retries in place; in_app should not normally fail, skip create.
        if (channel === "email" && existing.status === "failed") {
          actions.push({
            action: "retry",
            delivery_id: existing.id,
            task_id: task.id,
            threshold_id: threshold.id,
            channel: "email",
            days_before: threshold.days_before,
            retry_count: existing.retry_count,
          });
        }
      }
    }
  }

  return actions;
}
