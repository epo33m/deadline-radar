# Deadline Radar — Domain Model & Business Rules

> **Source of truth:** `product.md` (Baseline v0.1)
> This document defines *behavior* and *business rules* before moving into the technical schema (`DATA-MODEL.md`) or architecture (`ARCHITECTURE.md`).

---

## 1. Ubiquitous Language

| Term | Meaning |
|---|---|
| Profile | Representation of a logged-in user (1:1 with Supabase's `auth.users`) |
| Course | A course/subject, owned by one Profile |
| Task | A piece of coursework, owned by one Course & one Profile |
| Deadline | The date+time by which a task must be finished |
| Threshold | A point in time ("H-N") relative to the deadline that triggers a reminder |
| Notification Delivery | One reminder-sending attempt for a (task, days_before, channel) combination |
| Attachment | Supporting material for a task: a file or an external link |
| Role | Named set of capabilities (`user`, `admin`); assigned server-side via `user_roles` |
| Capability | Stable permission id (e.g. `course.create`, `role.assign`) |

## 2. Entities & Business Meaning

### 2.1 Profile
- Created automatically when the user registers (auto-provisioned, see `ARCHITECTURE.md`).
- Stores `timezone` — used for all reminder time calculations for that user.
- Stores `email` — a mirror of the Auth email, used by account UI and reminder delivery.
- All Courses & Tasks are owned by exactly one Profile.
- Receives the default `user` role on signup (RBAC). Roles are never trusted from the client.
- **Rule — account email lifecycle:** the account email is owned by Supabase Auth. A signed-in user may request a change; the **new address only** confirms the change (project setting "Confirm email change"). Until confirmed, the Profile email stays unchanged. After Auth confirms, `profiles.email` is updated to match via the `on_auth_user_email_changed` trigger (`DATA-MODEL.md` §4.3). The app never writes `profiles.email` directly for account changes.
- **Rule — sign-in email reauth:** signed-in password change and email change require the user's **current password** before the Auth update is accepted.

### 2.2 Course
- Purely organizational, scoped to its owner.
- **Rule:** `name` is required, cannot be empty.
- **Rule:** Course identity is the course `id` (uuid). Names are **not** unique per user — duplicate names are allowed.
- **Rule:** `code`, `color`, and `description` are optional display-only fields; empty values normalize to `null`.
- **Rule — soft delete:** removing a course sets `deleted_at`; it is excluded from active lists and from new task assignment. Rows are not hard-deleted in the MVP.
- **Open question:** how long should soft-deleted courses be retained before purge (if ever)? No retention period or automatic purge is defined yet — needs a future decision.

### 2.3 Task
- Must have a `course_id` (must belong to the same user) and a `deadline`.
- Status lifecycle: `todo` ↔ `in_progress` freely, then one-way `→ done`. **Completion is terminal in v1: users cannot reopen a completed task.** Completion is performed through the `Mark as done` action, which sets `status = done` and records `completed_at`. Completed tasks are read-only (no further edits; soft-delete still allowed).
- **Rule — past deadline:** a user may create a task with a deadline that has already passed (e.g. backfilling an old assignment). The system does not forbid this, but see the reminder rule in §4 regarding thresholds that have already passed.
- **Rule — soft delete:** removing a task sets `deleted_at`; it is excluded from active lists. Rows are not hard-deleted in the MVP (same pattern as courses). Hard delete would cascade to `reminder_thresholds`, `notification_deliveries`, and `attachments` (including storage files — see `ARCHITECTURE.md`); soft delete leaves those child rows in place until a future purge decision.

### 2.4 Reminder Threshold
- **4 rows** auto-generated when a task is created: `H-7, H-3, H-1, H-0` (relative to `deadline`).
- User can add/change/remove per task.
- **Rule:** `days_before` must be ≥ 0, and unique per task **among active (non-archived) thresholds** (no two live thresholds with the same `days_before` for the same task).
- **Rule — removal archives, never deletes (RF-09):** removing a threshold (via `PUT` replace or `DELETE`) sets `deleted_at`; the row and its `notification_deliveries` history are **retained**. Archived thresholds are excluded from evaluation, quota, and API reads. Direct hard deletes are blocked by a `BEFORE DELETE` guard trigger (`THRESHOLD_HARD_DELETE_FORBIDDEN`); only RI cascades (task/user deletion) may remove rows. This is what makes "when was this reminder sent?" auditable after a user removes an offset.

### 2.5 Notification Delivery
- One "due" threshold produces **2 delivery rows**: one for the `email` channel, one for `in_app`.
- **Rule — identity is `(task, days_before, channel)` (RF-10):** suppression/retry decisions key off the task, offset, and channel — **not** the `threshold_id`. A re-added offset gets a fresh threshold id, so matching by offset keeps an already-`sent`/`pending` offset from re-sending. The DB unique key remains `(threshold_id, days_before, channel)`; a failed row belonging to an archived threshold is not resurrected — a new row is created for the live threshold.
- Status lifecycle: `pending → sent` or `pending → failed`.
- `failed` (email only, e.g. a Resend error) is retried on subsequent scheduler runs up to a maximum of **3 retries** (`MAX_EMAIL_DELIVERY_RETRIES = 3`). The initial attempt is `retry_count = 0` (not counted as a retry), giving a maximum of **4 total attempts** (1 initial + 3 retries). Once `retry_count >= 3` fails, the delivery remains permanently in the `failed` status and is no longer scheduled for retries.
- **Rule — `sent` means accepted, not delivered:** a `sent` email delivery means the provider (Resend) accepted the request and queued it; it is **not** proof of inbox delivery. In v1 there is **no bounce/complaint webhook**, so a later bounce or spam complaint is invisible to the app — Resend's automatic suppression list is the upstream mitigation. A `sent` delivery is never re-sent.
- **Rule — frozen email body & idempotency key (RF-02):** the email body inputs (task title, deadline, profile timezone, threshold offset) are **frozen on the first send attempt** (`notification_deliveries.email_snapshot`). Every retry — including retries in a later scheduler run — rebuilds the exact same body, so the Resend idempotency key stays stable and editing a task between attempts cannot cause a duplicate email. If the provider terminally rejects the key, the key is **rotated once** (a fresh key over the same frozen body, persisted in `email_idempotency_key`) so the next retry can still deliver.
- `read_at` is only relevant for the `in_app` channel (filled when the user opens the notification center / clicks the notification).

### 2.6 Attachment
- Two types: `file` (uploaded to Supabase Storage) or `link` (external URL).
- **Rule (constraint):**
  - `type = file` → `storage_path` is required, `url` must be empty.
  - `type = link` → `url` is required (must be a valid absolute URL), `storage_path` must be empty.

## 3. Task Status Lifecycle

```
         ┌──────────┐
         │   todo   │◀──┐
         └────┬─────┘   │
              │         │
              ▼         │
       ┌──────────────┐ │
       │ in_progress  │─┘
       └──────┬───────┘
              │ Mark as done
              ▼
         ┌──────────┐
         │   done   │  🔒 terminal — no transitions out
         └──────────┘
```
(active tasks move freely between `todo`/`in_progress`; completion is one-way)

- **Rule:** while status = `done`, the scheduler **stops evaluating** that task for new reminders (thresholds not yet due will not trigger new deliveries).
- **Rule:** `done` is terminal — there is no reopen (`done` → `todo`/`in_progress` is rejected). Since reopen is unreachable, no special "thresholds missed while done" handling exists in the evaluator.

## 4. Reminder & Notification Business Rules

- **Threshold trigger time:** threshold `H-N` fires at `deadline - N days`, **at the same time of day as the deadline**, converted to the Profile's `timezone`. Example: deadline Friday 23:59 (Asia/Makassar) → H-3 fires Tuesday 23:59 (Asia/Makassar).
- **H-0** effectively equals the deadline time itself.
- **Rule — thresholds already past at creation time:** if a task's deadline is less than 7 days away (e.g. only 2 days left), then the H-7 and H-3 thresholds are automatically already "past due" when the task is created. The system **must not** fire reminders retroactively for thresholds that have already passed — such thresholds are marked as no longer relevant (skipped), rather than immediately flooding the user with notifications when the task is created.
- **Rule — custom thresholds must trigger in the future:** a **custom** (non-default) threshold whose trigger time is already in the past is **rejected** when added or edited (API validation error; the UI enforces the same check). This prevents creating reminders that can never fire. The four default offsets (H-7/H-3/H-1/H-0) are exempt: they may exist even when already past and are kept but skipped (per the rule above).
- **Rule — scheduler:** runs at least every hour (per `product.md`). A threshold is "due" when `now >= threshold_trigger_time` AND there is no existing delivery with status `pending`/`sending`/`sent` for that (task, days_before, channel) combination — matched by offset, so an archived-then-re-added threshold does not re-send (RF-09/RF-10).
- **Rule — editing the deadline:** if the user changes a task's `deadline`, the trigger time of all thresholds shifts accordingly (since thresholds are stored as `days_before`, not an absolute date). Thresholds whose new trigger time has already passed at the moment of editing are **not** fired retroactively (same rule as above).
- **Rule — adding an existing threshold is idempotent (RF-06):** adding an offset that already exists for the task is treated as **success** and returns the existing threshold (`200`), not an error — the intent "this offset should exist" is already satisfied. When the request carries an `Idempotency-Key`, a repeated submit (double-click/network retry) replays the original response verbatim.
- **Rule — one scheduler run at a time (RF-04):** the reminder evaluator is **single-flight**. A second trigger while a run is active does no work and exits as `skipped` (cron reports `outcome: "skipped"`); a run that crashed without finishing is reclaimed after a stale horizon (30 minutes). This is what makes the per-user email quota a true per-interval cap rather than a per-process one.
- **Rule — lock is fail-closed (NEW-01):** if the single-flight lock cannot be acquired (bounded retries, then abort), a run **never proceeds** — it produces zero deliveries and reports `outcome: "lock-unavailable"` + a Sentry warning. A run missing the lock because of a DB outage must not silently "succeed" any more than an empty run may. The 30-minute reclaim horizon guarantees a lock is never permanently lost.
- **Rule — exactly one scheduler instance (RF-16):** production schedules the cron endpoint from a **single** managed HTTP cron (Railway / Cron-job.org / UptimeRobot). Multi-`replica` triggering is out of scope; the single-flight lock is the backstop, not the primary model.
- **Rule — a run is bounded (RF-12):** a single evaluation stops after at most `MAX_TASKS_PER_RUN` tasks or `MAX_RUN_DURATION_MS` of wall-clock (whichever comes first), checked **between batches** so every batch is atomic and checkpointed. A run that stops at a bound is **not a failure**: it finishes the ledger row cleanly (`status ok`, `truncated = true`, cursor at the last full batch) and the **next scheduled run picks up the remainder** — the scheduler re-scans all open tasks, and already-`sent`/`pending` deliveries suppress re-sends via the (task, offset, channel) identity, so a bounded run can never lose a reminder or double-send.
- **Rule — a send is cancelled if the deadline/threshold changes mid-run (RF-07):** before an email is sent, the scheduler compares the live `deadline_updated_at` and threshold version against the batch snapshot it evaluated. If either changed, the queued delivery is **cancelled** (the row is removed and no quota is spent) and the task is re-evaluated on the next run with the new values. Unrelated edits (title, status, course) do not cancel a send; the frozen body from §2.5 still governs the email content.
- **Rule — scheduler-activation cutoff (F-03):** thresholds that triggered before the `REMINDER_CUTOFF_ISO` instant (the scheduler-activation moment, set by ops) are **never fired** — no creates, no retries — so enabling the scheduler over historical tasks cannot flood users with stale reminders. In production the variable is **required** and validated at boot (RF-11 fail-closed); in dev/test no cutoff is applied.
- **Rule — late labeling (RF-11):** a reminder whose trigger is ≥ 1 hour stale (`REMINDER_LATE_AFTER_MS`) at evaluation time is a **late / catch-up** delivery — the scheduler was offline for a cycle. Emails get a `[LATE]` tag in the subject (and a body line); the label is **frozen** into the email snapshot on the first attempt, so retries keep it and the idempotency key stays stable. In-app notifications have no body, so the same label is **derived on read**: the notification is late when `sent_at` is at least 1h after the (timezone-aware) trigger instant.
- **Rule — no nagging after the deadline (RF-11):** once a task's deadline is past by more than a 1h grace (`REMINDER_DEADLINE_GRACE_MS`), the scheduler stops producing reminders for it entirely — creates and retries alike. The grace keeps H-0 "today!" deliverable in the first hourly cron run after the deadline.

## 5. Validation Rules Summary

| Field | Rule |
|---|---|
| `Course.name` | required, cannot be empty; not unique per user (identity is `id`) |
| `Course` delete | soft delete via `deleted_at` (no hard delete in MVP) |
| `Task.title` | required, cannot be empty |
| `Task.course_id` | required, must belong to the same user; new tasks require an active (not soft-deleted) course |
| `Task.deadline` | required (datetime) |
| `Task` delete | soft delete via `deleted_at` (no hard delete in MVP) |
| `Attachment.type=file` | `storage_path` required, `url` empty |
| `Attachment.type=link` | `url` required (valid URL), `storage_path` empty |
| `ReminderThreshold.days_before` | integer ≥ 0, unique per task among active (non-archived) thresholds; custom values must not have a trigger time already in the past |

## 6. Explicitly Not Modeled in the MVP
- Priority level per task
- Recurring tasks
- Task sharing/collaboration between users
- Dependencies between tasks
- Multi-tenant organizations / workspaces (tenant isolation **N/A** — per-profile ownership only)
- Role hierarchy / permission inheritance (roles are flat)
- Admin cross-user access to another profile’s courses/tasks

## 7. Open Domain Questions
- [x] Maximum retries for a `failed` email delivery? (Resolved: 3 retries max, total 4 attempts, permanent `failed` afterwards — M-5)
- [x] Confirm: does reopening a task from `done` reactivate reminders for thresholds that haven't passed yet? (Resolved: reopen removed in v1 — `done` is terminal, so the question is moot. F-02 closed by lifecycle decision.)
- [ ] Data retention for soft-deleted courses and tasks: how long to keep `deleted_at IS NOT NULL` rows, and should there be an automatic purge? (No retention period or purge policy yet.) Course retention tracked in #16.
- [ ] Confirm the threshold trigger-time rule: same hour/minute as `deadline`, in the Profile's timezone — does this match your expectations?
- [ ] Data retention for `auth_audit_events` (L-11): how long to keep authentication/authorization audit rows (IP, User-Agent, user reference, event metadata), per product/legal/security policy. No retention period is defined; without a decision the trail is append-only and nothing is purged. The purge mechanism is ready and inert until `AUTH_AUDIT_RETENTION_DAYS` is set.
