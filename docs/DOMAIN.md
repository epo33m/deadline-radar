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
| Notification Delivery | One reminder-sending attempt for a (task, threshold, channel) combination |
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
- **Rule — soft delete:** removing a course sets `deleted_at`; it is excluded from active lists and from new task assignment. Rows are not hard-deleted in the MVP.
- **Open question:** how long should soft-deleted courses be retained before purge (if ever)? No retention period or automatic purge is defined yet — needs a future decision.

### 2.3 Task
- Must have a `course_id` (must belong to the same user) and a `deadline`.
- Status lifecycle: `todo` ↔ `in_progress` ↔ `done` — **free to move in any direction** (MVP does not enforce a strict workflow order).
- **Rule — past deadline:** a user may create a task with a deadline that has already passed (e.g. backfilling an old assignment). The system does not forbid this, but see the reminder rule in §4 regarding thresholds that have already passed.
- **Rule — soft delete:** removing a task sets `deleted_at`; it is excluded from active lists. Rows are not hard-deleted in the MVP (same pattern as courses). Hard delete would cascade to `reminder_thresholds`, `notification_deliveries`, and `attachments` (including storage files — see `ARCHITECTURE.md`); soft delete leaves those child rows in place until a future purge decision.

### 2.4 Reminder Threshold
- **4 rows** auto-generated when a task is created: `H-7, H-3, H-1, H-0` (relative to `deadline`).
- User can add/change/remove per task.
- **Rule:** `days_before` must be ≥ 0, and unique per task (no two thresholds with the same `days_before` for the same task).

### 2.5 Notification Delivery
- One "due" threshold produces **2 delivery rows**: one for the `email` channel, one for `in_app`.
- Status lifecycle: `pending → sent` or `pending → failed`.
- `failed` (email only, e.g. a Resend error) is retried on the next scheduler run — **the maximum retry count is still TBD** (recommendation: 3x, then left as permanently `failed`).
- `read_at` is only relevant for the `in_app` channel (filled when the user opens the notification center / clicks the notification).

### 2.6 Attachment
- Two types: `file` (uploaded to Supabase Storage) or `link` (external URL).
- **Rule (constraint):**
  - `type = file` → `storage_path` is required, `url` must be empty.
  - `type = link` → `url` is required (must be a valid absolute URL), `storage_path` must be empty.

## 3. Task Status Lifecycle

```
        ┌──────────┐
   ┌───▶│   todo   │◀───┐
   │    └────┬─────┘    │
   │         │           │
   │         ▼           │
   │  ┌──────────────┐   │
   └──│ in_progress  │───┘
      └──────┬───────┘
             │
             ▼
        ┌──────────┐
        │   done   │
        └──────────┘
   (user can reopen: done → todo/in_progress)
```

- **Rule:** while status = `done`, the scheduler **stops evaluating** that task for new reminders (thresholds not yet due will not trigger new deliveries).
- **Rule (assumption, needs confirmation):** if a task is *reopened* (`done` → `todo`/`in_progress`), reminders for thresholds that **have not yet passed** become active again. Thresholds whose time already passed before the reopen are not fired retroactively.

## 4. Reminder & Notification Business Rules

- **Threshold trigger time:** threshold `H-N` fires at `deadline - N days`, **at the same time of day as the deadline**, converted to the Profile's `timezone`. Example: deadline Friday 23:59 (Asia/Makassar) → H-3 fires Tuesday 23:59 (Asia/Makassar).
- **H-0** effectively equals the deadline time itself.
- **Rule — thresholds already past at creation time:** if a task's deadline is less than 7 days away (e.g. only 2 days left), then the H-7 and H-3 thresholds are automatically already "past due" when the task is created. The system **must not** fire reminders retroactively for thresholds that have already passed — such thresholds are marked as no longer relevant (skipped), rather than immediately flooding the user with notifications when the task is created.
- **Rule — scheduler:** runs at least every hour (per `product.md`). A threshold is "due" when `now >= threshold_trigger_time` AND there is no existing delivery with status `sent`/`pending` for that (task, threshold, channel) combination.
- **Rule — editing the deadline:** if the user changes a task's `deadline`, the trigger time of all thresholds shifts accordingly (since thresholds are stored as `days_before`, not an absolute date). Thresholds whose new trigger time has already passed at the moment of editing are **not** fired retroactively (same rule as above).

## 5. Validation Rules Summary

| Field | Rule |
|---|---|
| `Course.name` | required, cannot be empty; not unique per user (identity is `id`) |
| `Course` delete | soft delete via `deleted_at` (no hard delete in MVP) |
| `Task.title` | required, cannot be empty |
| `Task.course_id` | required, must belong to the same user; new tasks require an active (not soft-deleted) course |
| `Task.deadline` | required (datetime) |
| `Task.estimated_duration` | optional integer minutes (free-text alternate still open in `product.md` §10) |
| `Task` delete | soft delete via `deleted_at` (no hard delete in MVP) |
| `Attachment.type=file` | `storage_path` required, `url` empty |
| `Attachment.type=link` | `url` required (valid URL), `storage_path` empty |
| `ReminderThreshold.days_before` | integer ≥ 0, unique per task |

## 6. Explicitly Not Modeled in the MVP
- Priority level per task
- Recurring tasks
- Task sharing/collaboration between users
- Dependencies between tasks
- Multi-tenant organizations / workspaces (tenant isolation **N/A** — per-profile ownership only)
- Role hierarchy / permission inheritance (roles are flat)
- Admin cross-user access to another profile’s courses/tasks

## 7. Open Domain Questions
- [ ] Maximum retries for a `failed` email delivery? (suggestion: 3x)
- [ ] Confirm: does reopening a task from `done` reactivate reminders for thresholds that haven't passed yet?
- [ ] Data retention for soft-deleted courses and tasks: how long to keep `deleted_at IS NOT NULL` rows, and should there be an automatic purge? (No retention period or purge policy yet.) Course retention tracked in #16.
- [ ] Confirm the threshold trigger-time rule: same hour/minute as `deadline`, in the Profile's timezone — does this match your expectations?
