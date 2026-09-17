# Deadline Radar — MVP Scope

> **Source of truth:** `product.md` (Baseline v0.1), `DOMAIN.md`, `ARCHITECTURE.md`, `DATA-MODEL.md`

---

## 1. Definition of "MVP Done"

The MVP is considered done when: a user can register, log in, create a course, create a task with a deadline, receive automatic reminders (email + in-app) that escalate according to the thresholds, update the task status, attach a file/link, and monitor everything via the Summary/calendar — all running end-to-end in the production environment, with data isolated per user.

## 2. In Scope (MVP)

| Area | Feature |
|---|---|
| Auth | Register & login (email/password) |
| Course | Course CRUD (name, optional code, color, description) |
| Task | Task CRUD (title, description, course, deadline, status) |
| Attachment | Add/remove attachments as a file (upload) or an external link |
| Reminder | Default threshold H-7/H-3/H-1/H-0 auto-created when a task is created; user can customize per task |
| Notification | Reminders delivered via email (Resend) & in-app (bell icon + notification center) |
| Summary | Task summary: approaching deadline, overdue, recently completed |
| Calendar | Monthly view of deadline distribution |

## 3. Out of Scope (Deferred)

Per `product.md` §9 — **intentionally not built** in the MVP:
- Priority level per task
- Google OAuth / magic link login
- Task collaboration/sharing between users
- External calendar integration (Google Calendar, etc.)
- Recurring tasks
- Native mobile app
- Supabase Realtime for notifications (MVP uses polling)

## 4. Core User Flows

### 4.1 Register & Login
1. User signs up with email + password.
2. The system automatically creates a `profiles` row (trigger).
3. User sets/confirms their timezone (defaults to browser detection, can be changed manually).

### 4.2 Create a Course
1. User opens `/courses`, clicks "Add Course".
2. Fills in name (required), code & color (optional).
3. The course is ready to be assigned to tasks.

### 4.3 Create a Task
1. User opens `/tasks`, clicks "Add Task".
2. Fills in title, selects course, deadline & description.
3. The system automatically generates 4 reminder thresholds (H-7/H-3/H-1/H-0).
4. (Optional) user customizes thresholds, adds attachments (file/link).

### 4.4 Update Status & Reopen a Task
1. User changes the task status: `todo → in_progress → done` (or reopens it the other way).
2. Once `done`, reminders that haven't fired yet automatically stop being evaluated.

### 4.5 Automatic Reminders (system-triggered)
1. Scheduler runs hourly, checks for due thresholds.
2. Sends email (Resend) + inserts an in-app notification for each match.
3. User sees new notifications on the bell icon and can click to mark as read.

### 4.6 Monitor via Summary/Calendar
1. User opens `/summary` → sees tasks approaching deadline, overdue, and recently completed.
2. User opens `/calendar` → sees the monthly spread of deadlines.

## 5. Acceptance Criteria (key examples)

**Auto-generate thresholds**
> Given a user creates a new task with a deadline 10 days from now,
> When the task is successfully saved,
> Then the system automatically creates 4 reminder thresholds (H-7, H-3, H-1, H-0) for that task.

**Reminders are not retroactive**
> Given a user creates a task with a deadline 2 days from now,
> When the task is successfully saved,
> Then the H-7 and H-3 thresholds (whose time has already passed) do not trigger an immediate reminder right then.

**Reminders stop once done**
> Given a task has thresholds that haven't fired yet,
> When the user changes the task status to "Done",
> Then the scheduler no longer evaluates/sends reminders for that task.

**Data isolation between users**
> Given two different users (A and B) each have their own tasks,
> When user A logs in,
> Then user A can only view/edit their own courses & tasks, not user B's.

**Attachment matches its type**
> Given a user adds an attachment of type "link",
> When the user doesn't fill in a URL,
> Then the system rejects saving it and asks for the URL to be filled in.

## 6. Definition of Done (MVP launch)

- [ ] All flows in §4 work end-to-end in the production environment.
- [ ] RLS verified: a user cannot access another user's data (minimal manual test).
- [ ] Email & in-app reminders proven to be delivered according to thresholds (tested with a near-term deadline).
- [ ] Scheduler runs automatically at least every hour in production.
- [ ] Deployed & publicly accessible (final hosting, see §7).

## 7. Still-Pending Decisions (don't block starting development, but must be finalized before launch)

- [ ] Scheduler runner for Elysia cron endpoint (`ARCHITECTURE.md` §2.6)
- [ ] Final hosting
- [ ] Attachment file size & type limits
- [ ] Max retry attempts for failed email deliveries
