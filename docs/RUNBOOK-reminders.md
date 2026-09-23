# Runbook — Reminder Delivery (cron → Resend)

Scope: `GET /api/v1/cron/evaluate-reminders` → `runEvaluateReminders()` → Resend.
All diagnosis below is read-only SQL unless marked otherwise.

## 1. Is the scheduler alive?

```sql
-- Last run and its outcome. A missing recent row means the scheduler
-- (not the app) is dead; a row with status='error' means the run crashed.
SELECT id, started_at, finished_at, status, error, truncated,
       evaluated_tasks, created, retried,
       emails_sent, emails_failed, emails_skipped_quota,
       last_seen_task_id
FROM public.reminder_runs
ORDER BY started_at DESC LIMIT 5;
```

- No row within 2× the cron interval → check the external scheduler (managed HTTP cron — Railway Cron Job / Cron-job.org / UptimeRobot — see ARCHITECTURE §2.6), then `CRON_SECRET` and API logs for `[cron] evaluate-reminders finished`. This is automated by `GET /health/cron` (§8) — polling it from an uptime monitor is the "no ok run within 2× interval" alert.
- `status='running'` with an old `started_at` and no `finished_at` → a run died mid-flight (crash between start-row insert and finish). Deliveries are safe (see §3); investigate API logs around `started_at`.
- `outcome: "skipped"` in the `[cron] evaluate-reminders finished` log (RF-04) → the single-flight lock was held by another run, so this trigger did no work. This is expected under overlap, not an error. If it happens on *every* trigger, check for a stuck `status='running'` row: it is reclaimed automatically once `started_at` is older than 30 minutes (`RUN_LOCK_STALE_MS`).
- `truncated = true` on a `status='ok'` row (RF-12) → the run stopped cleanly at `MAX_TASKS_PER_RUN` or `MAX_RUN_DURATION_MS` before scanning all open tasks. **Do not retry manually** — the next scheduled run re-scans from the head and mops up the remainder (already-`sent`/`pending` deliveries suppress re-sends). The cron log line records the run (`truncated: true`) and, on truncation, an `[reminders] run truncated at N tasks …; M open tasks remain behind the cursor` line gives backlog depth. Recurring truncation on every run means the caps are below the tenant's steady-state open-task volume: raise `MAX_TASKS_PER_RUN` (or, if the host timeout demands it, shrink the interval) in the API env. `MAX_RUN_DURATION_MS` is clamped just under the 30-minute lock horizon so a truncated run can never wedge the single-flight lock.
- `outcome: "lock-unavailable"` in the `[cron] evaluate-reminders finished` log with a `[reminders] run lock unavailable, aborting run` line (NEW-01) → the single-flight lock (or the run ledger start-row with it) could not be acquired after the bounded retries — typically the DB is down or wedged. The run aborted **fail-closed**: zero deliveries, zero `reminder_runs` row, Sentry warning raised. If `GET /health/cron` (§8) also 503s, this confirms the API/DB is unhealthy — investigate the DB, not the scheduler.

## 2. Why did email X fail?

```sql
SELECT status, retry_count, last_error, failed_at, claimed_at, sent_at
FROM public.notification_deliveries
WHERE id = '<delivery-id>';
```

- `status='failed'`, `retry_count < 3` → will be retried automatically next run. `last_error`/`failed_at` say why and when.
- `status='failed'`, `retry_count >= 3` → terminal. Will never retry on its own (see §4 for manual resend).
- `status='sending'` with `claimed_at` older than 15 minutes → orphaned claim from a crashed run; the next sweep reclaims it automatically (`SENDING_CLAIM_STALE_MS`). A fresh `claimed_at` means another run is actively sending — hands off.
- `status='pending'` for a `done` task → orphaned by a mid-run completion; skipped by design, never sent.
- A due threshold with **no** delivery row at all → either it has not been evaluated yet, or the queued send was cancelled because the deadline/threshold was edited mid-run (RF-07). Cancelled rows are **deleted** (so a later run can re-create them cleanly); look for `[reminders] skipped send, task edited mid-run` in the logs. The next run re-evaluates with the new values — no action needed.
- Removed a threshold but the delivery history is still there → expected since RF-09: removal **archives** (`reminder_thresholds.deleted_at`) instead of cascading, so sent/failed/pending rows are retained for audit. Archived thresholds are invisible to the evaluator and to quota; re-adding the same offset will **not** re-send an offset that was already `sent` (RF-10 — delivery identity is `(task, days_before, channel)`). A `pending` row under an archived threshold is swept as stale and never sent. Direct hard deletes are rejected with `THRESHOLD_HARD_DELETE_FORBIDDEN`; only task/user cascades may remove thresholds.

## 3. Did duplicate sends happen?

One row = one logical reminder; retries reuse the row (`retry_count` increments, no new row). Confirm with:

```sql
SELECT threshold_id, days_before, channel, COUNT(*)
FROM public.notification_deliveries
GROUP BY 1, 2, 3 HAVING COUNT(*) > 1;
```

Must return zero rows (unique index enforces this). If a user reports two identical emails, compare `deliveryId`: same id → provider redelivery (check Resend dashboard with the idempotency key `reminder-delivery-<uuid>-<hash>`); different ids → file a bug, the dedupe key changed or was bypassed.

**Frozen body / key (RF-02).** Since RF-02 the email body inputs are frozen per delivery on the first send attempt (`notification_deliveries.email_snapshot`) and the exact key is stored in `email_idempotency_key`. To trace a reported duplicate, read both columns on the delivery:

```sql
SELECT id, status, retry_count, last_error, email_snapshot, email_idempotency_key
FROM public.notification_deliveries
WHERE id = '<delivery-id>';
```

- Same `delivery_id`, same key across the attempts → provider redelivery.
- Same `delivery_id`, **different** keys → the key was rotated after a terminal provider rejection (`invalid_idempotent_request` / `invalid_idempotency_key`); `last_error` names the original rejection. Rotation is one-shot, so the next retry delivers under the new key.
- Different `delivery_id`s → the one-row-per-reminder invariant was broken; file a bug.

Because the body is frozen, an edit to the task title/deadline after the first attempt does **not** change the key on retry (see `DOMAIN.md` §2.5).

## 4. Safe manual resend (terminal failures only)

Never INSERT a new delivery row (breaks the one-row-per-reminder invariant). Instead, reset the terminal row for the normal retry path:

```sql
-- Re-arms ONE terminal delivery for the next cron run. The run claims it
-- atomically and sends under the same idempotency key; provider dedups
-- if the original actually landed.
UPDATE public.notification_deliveries
SET status = 'failed', retry_count = 0,
    last_error = NULL, failed_at = NULL
WHERE id = '<delivery-id>' AND status = 'failed';
```

Then watch the next `[cron] evaluate-reminders finished` log (`emailsSent`, `emailsFailed`) and the Sentry `reminder delivery blackout` alert (fires only when every attempted send in a run fails).

## 5. First deploy / re-activation

Set `REMINDER_CUTOFF_ISO` to the activation instant (template in `.env.example`; used only in production, where it is **required** — the API boots with a 500 otherwise). Without it, the first run evaluates all historical tasks and sends everything past-due, throttled only by the 50/run/user quota. To preview impact, run the evaluator read path (task/threshold/delivery selects) with a candidate cutoff and count due thresholds before setting it live.

After activation, catch-up runs no longer nag about overdue tasks: reminders whose trigger is ≥ 1h stale are labeled `[LATE]` (emails) / can be flagged in-app (derived on read), and once a deadline is past by more than 1h (`REMINDER_DEADLINE_GRACE_MS`) no reminders for that task are scheduled at all — H-0 "today!" still fires in the first hourly run after the deadline.

## 6. Deploy ordering

Run `bun run db:migrate` **before** deploying code that depends on new schema (notably the `sending` enum value + `claimed_at`: without them the sweep claim throws and every run 500s). Verify with `bun run db:drift` — expect only the known `profiles_id_fkey` deviation. Rolling back code is safe (old sweep ignores `sending` rows; old evaluator suppresses them by fall-through); rolling back the enum value is not possible while `sending` rows exist.

CI already enforces the ordering: `ci.yml` runs `bun run scripts/migrate.ts status` + `verify` (fails on pending), and deploy jobs run migrations before releasing the API. As a last-moment safety net, production boot now also refuses to start when the DB is behind the API in the one way that matters — missing enum value `sending` or column `claimed_at` throws `Database schema is behind this API build (RF-15) … Run "bun run db:migrate" BEFORE deploying this API build` before the listener opens. If you see that message, run the migration, then start again.

## 8. Monitoring & alerting (RF-14)

**Uptime probe — `GET /health/cron`** (public, read-only, per-[`rate-limit`](/Users/voldys/project/deadline-radar) default bucket). Answers `200 {ok:true, lastRunAt, lastStatus, evaluatedTasks}` when the latest `reminder_runs` row is `ok`, finished, and started within `2 × REMINDER_RUN_INTERVAL_MS` (default 1 hour; env-lenient). `503` otherwise — stale `ok`, `error`, a `running` row stuck past the lock horizon, or no rows at all (scheduler never ran).

Wire an external monitor (UptimeRobot, StatusCake, etc.) to poll it every minute and alert on `503` (and on lingering `5xx`). `GET /health` currently just proves the API process is up; `GET /health/cron` proves the scheduler actually ran recently — the MTTD fix for "cron not running".

**Alerting in Sentry:** a run capped by `MAX_TASKS_PER_RUN` / `MAX_RUN_DURATION_MS` raises a warning-level `"reminder run truncated…"` message (suppressed when the same run already raised the blackout alert, whose extras include `truncated`). Treat repeated truncation alerts as capacity: raise the cap or shrink the interval (§1).

**Dashboard SQL (read-only):**

```sql
-- Failed deliveries per day (trends; join §2 on last_error for patterns)
SELECT created_at::date AS day,
       count(*) FILTER (WHERE status = 'failed')  AS failed,
       count(*) FILTER (WHERE status = 'sent')    AS sent,
       count(*) FILTER (WHERE status = 'sending') AS stuck_sending
FROM public.notification_deliveries
WHERE created_at >= now() - interval '14 days'
GROUP BY day ORDER BY day;
```

```sql
-- Stale `sending` rows (crashed sweep/claim — normally reclaimed ≤ 15 min)
SELECT count(*) AS stale_sending
FROM public.notification_deliveries
WHERE status = 'sending' AND claimed_at < now() - interval '15 minutes';
```

```sql
-- Quota backlog: opens per run that were skipped despite a "wide-open" quota
SELECT id, started_at, emails_skipped_quota
FROM public.reminder_runs
ORDER BY started_at DESC LIMIT 10;
```

Action guidance: `failed/day` rising → see §2; `stuck_sending > 0` → stale claim, next run reclaims (check for a stuck `running` run first, §1); `emails_skipped_quota` climbing → quota noise is by design (50/run/user) — only act if users report "reminder missing" AND skipped grows.

## 9. Quota backstop (SEC-003 / C4)

Direct PostgREST writes cannot bypass quotas: `task_quota_before_insert` (200 active tasks/user) and `threshold_quota_before_insert` (10/task) reject over-quota INSERTs with `TASK_QUOTA_EXCEEDED` / `THRESHOLD_QUOTA_EXCEEDED`, and direct `notification_deliveries` fabrication stays denied by RLS (42501). If users report "cannot create task" with a quota message, check their active-task count (`deleted_at IS NULL`) — soft-deleted tasks free their slot. The scheduler/`service_role` path intentionally bypasses these triggers; never run app traffic under `service_role` or the backstop is blind. Cost alerting (Resend dashboard) is still required — quotas bound rows, not spend (checklist §4).
