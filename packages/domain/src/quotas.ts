/**
 * Product quota policy (SEC-003): per-user resource bounds that cap the
 * email-cost blast radius of the reminder pipeline.
 *
 * - `MAX_ACTIVE_TASKS_PER_USER`: active (non-deleted) tasks a user may own.
 *   Enforced at creation time in `POST /api/v1/tasks` (429 beyond).
 * - `MAX_THRESHOLDS_PER_TASK`: reminder thresholds per task. Enforced in
 *   `POST /:id/thresholds` and `PUT /:id/thresholds` (429 beyond).
 * - `MAX_EMAILS_PER_USER_PER_RUN`: email sends per user per cron run in
 *   `runEvaluateReminders`. Excess deliveries stay `pending` for the next
 *   run (never marked `failed`) and are reported as `emailsSkippedQuota`.
 *
 * Together these bound total email liability to
 * `users × tasks × thresholds` (creation) and per-run spend to
 * `users × MAX_EMAILS_PER_USER_PER_RUN` (delivery).
 *
 * Values are a product decision (audit ROUND 1, 2026-09-19). Changing them
 * is a config-level decision — update the matching tests.
 */
export const MAX_ACTIVE_TASKS_PER_USER = 200;

export const MAX_THRESHOLDS_PER_TASK = 10;

export const MAX_EMAILS_PER_USER_PER_RUN = 50;
