/**
 * First-run burst guard (Finding F-03).
 *
 * The very first scheduler run after activation would otherwise evaluate
 * every historical task and immediately create + send reminders for all
 * long-past-due thresholds (bounded only by the per-user quota) — the
 * classic day-one email burst.
 *
 *   REMINDER_CUTOFF_ISO=<ISO instant>   (ops sets it to the scheduler-activation instant)
 *
 * Thresholds that triggered before the cutoff stay silent (creates and
 * retries alike); thresholds triggering at/after it behave normally, even
 * on old tasks. While the variable is unset, blank, or not a valid date,
 * there is no cutoff — exactly the pre-existing behavior. Invalid values
 * are warned about once per resolution, never thrown: a typo must not be
 * able to break the whole cron run.
 */
export const REMINDER_CUTOFF_ENV = "REMINDER_CUTOFF_ISO";

export function getReminderCutoff(): Date | null {
  const raw = process.env[REMINDER_CUTOFF_ENV];
  if (!raw || raw.trim() === "") return null;
  const ms = Date.parse(raw);
  if (Number.isNaN(ms)) {
    console.warn(
      `[reminders] ignoring invalid ${REMINDER_CUTOFF_ENV} (expected ISO date): ${raw}`,
    );
    return null;
  }
  return new Date(ms);
}

/**
 * RF-11: fail-closed production configuration for the burst guard.
 *
 * The F-03 first-run burst guard silently degrades to "no cutoff" when
 * REMINDER_CUTOFF_ISO is missing or invalid — the very day-one flood it
 * exists to prevent. Production therefore refuses to boot without a valid
 * value. Development/test stay untouched, so local work and CI can boot
 * without it.
 *
 * The error messages name only the variable (and, for operability, the
 * offending value — a non-secret ISO instant).
 */
export function assertReminderCutoffConfigured(): void {
  if (process.env.NODE_ENV !== "production") return;

  const raw = process.env[REMINDER_CUTOFF_ENV];
  if (!raw || raw.trim() === "") {
    throw new Error(
      `${REMINDER_CUTOFF_ENV} is required when NODE_ENV=production: without it the first-run burst guard (F-03) is silently disabled.`,
    );
  }
  if (Number.isNaN(Date.parse(raw))) {
    throw new Error(
      `${REMINDER_CUTOFF_ENV} must be a valid ISO date when NODE_ENV=production (got: "${raw}").`,
    );
  }
}
