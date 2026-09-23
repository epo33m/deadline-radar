# Deadline Radar — Product Requirements Document

> **Status:** Baseline v0.1 (locked)
> **Owner:** (add your name)
> **Last updated:** 2026-09-05

---

## 1. Summary

**Deadline Radar** is a web-based personal academic task tracker that helps students remember, monitor, and complete coursework before deadlines through centralized task tracking and tiered reminders via email and in-app notifications.

The app is hosted and multi-user (each user has their own account, with data isolated per user).

## 2. Problem & Goals

**Problem:** Students often miss or forget assignments because deadlines are scattered across many courses, there's no single centralized place to track them, and generic reminders (a regular calendar) aren't "urgent" enough as the deadline approaches.

**Goals:**
- One centralized Summary for all tasks across all courses.
- Automatic reminders that escalate in intensity as the deadline approaches, via email and in-app notifications.
- Fast setup: create a course, create a task, deadline & reminders are set automatically without extra effort (but still customizable).

## 3. Target Users

- Individual students who want to track their own coursework.
- Multi-user by design (hosted for the public/friends), with authentication & per-account data isolation.

## 4. Tech Stack

| Layer | Choice |
|---|---|
| Monorepo | Nx + Bun workspaces |
| UI | Next.js (App Router) — `apps/web` :3025 |
| API | Elysia (Bun) — `apps/api` :4025 |
| Language | TypeScript |
| Styling | Tailwind CSS |
| UI Components | shadcn/ui |
| Schema validation | Zod (`packages/validation`) |
| ORM | Drizzle (`packages/db`) |
| Database | Supabase PostgreSQL |
| Auth | Supabase Auth (session owned by API) |
| API contract | OpenAPI |
| Storage | Supabase Storage |
| Email | Resend |
| Hosting | **TBD** |
| Scheduler | One production instance (RF-16). Managed HTTP cron — Railway Cron Job (recommended default), Cron-job.org, or UptimeRobot — hits Elysia `GET /api/cron/evaluate-reminders` hourly |

## 5. Core Features (MVP)

### 5.1 Authentication

**MVP:**
- Register & login with email/password (Supabase Auth).

**Future phase:**
- Google OAuth
- Magic link

Data isolation: each user can only view/edit their own courses & tasks (Supabase Row Level Security).

### 5.2 Course Management
- User creates their own list of courses (separate CRUD, not free-text tags).
- Basic fields: course name, code/abbreviation (optional), label color (optional, to differentiate in Summary/calendar).
- Tasks are later assigned to one of these courses.

### 5.3 Task & Deadline Management
- Task CRUD with fields:
  - Task title
  - Course (relation to Course)
  - Description/notes (optional)
  - Deadline (date + time)
  - Status: **To Do / In Progress / Done**
- Attachment: user can add a file or external link related to the task (see 5.6).

### 5.4 Reminder System (Email + In-App)
- **Automatic tiered** reminders: the closer the deadline, the more frequent the reminders.
- Every new task automatically gets a **default reminder threshold: H-7, H-3, H-1, H-0** (H-0 = the deadline day itself).
- User can add, change, or remove these thresholds at any time, per task.
- Two reminder channels, sent together whenever a threshold is met:
  - **Email** (via Resend)
  - **In-app notification** (bell icon / notification center on the Summary)
- A reminder that's already been sent is not resent for the same task + threshold + channel combination.
- Reminders automatically stop/become irrelevant once the task status is "Done".

### 5.5 Summary & Calendar View
- The Summary shows a task summary: approaching deadline, overdue, and recently completed.
- Calendar view (monthly, at minimum) to visually see the spread of deadlines.
- Notification bell icon shows the in-app reminder history (read/unread).

### 5.6 File Attachment
- User can add an attachment as a **file** (upload to Supabase Storage) or an **external link** (e.g. Google Drive, GitHub repository, LMS assignment).
- More than one attachment per task is allowed, mixing files & links.
- **TBD:** size limit & allowed file types for file-type attachments.

## 6. Data Model (draft)

**profiles** *(1:1 with Supabase's `auth.users` — not a separate `users` table)*
| Field | Type |
|---|---|
| id | uuid (PK, FK → auth.users.id) |
| email | text |
| name | text |
| timezone | text (default based on the user's timezone at onboarding, e.g. `Asia/Makassar`) |
| created_at | timestamp |

```
auth.users
     │
     ▼
  profiles
     │
     ├── courses
     └── tasks
```

**courses**
| Field | Type |
|---|---|
| id | uuid (PK) |
| user_id | uuid (FK → profiles.id) |
| name | text |
| code | text (nullable) |
| color | text (nullable) |
| created_at | timestamp |
| deleted_at | timestamp (nullable; soft delete) |

**tasks**
| Field | Type |
|---|---|
| id | uuid (PK) |
| user_id | uuid (FK → profiles.id) |
| course_id | uuid (FK → courses) |
| title | text |
| description | text (nullable) |
| deadline | timestamptz |
| status | enum: `todo` \| `in_progress` \| `done` (`done` is terminal — no reopen in v1) |
| created_at | timestamp |
| updated_at | timestamp |
| deleted_at | timestamp (nullable; soft delete) |

**reminder_thresholds**
| Field | Type |
|---|---|
| id | uuid (PK) |
| task_id | uuid (FK → tasks) |
| days_before | integer (default generated: 7, 3, 1, 0) |
| is_default | boolean |

**notification_deliveries** *(previously `reminder_logs`)*
| Field | Type |
|---|---|
| id | uuid (PK) |
| task_id | uuid (FK → tasks) |
| threshold_id | uuid (FK → reminder_thresholds) |
| channel | enum: `email` \| `in_app` |
| status | enum: `pending` \| `sent` \| `failed` |
| sent_at | timestamp (nullable) |
| read_at | timestamp (nullable, `in_app` channel only) |

**attachments**
| Field | Type |
|---|---|
| id | uuid (PK) |
| task_id | uuid (FK → tasks) |
| type | enum: `file` \| `link` |
| name | text |
| storage_path | text (nullable — **required if `type = file`**) |
| url | text (nullable — **required if `type = link`**) |
| created_at | timestamp |

## 7. Reminder Logic (brief flow)

1. When a new task is created → the system automatically generates 4 `reminder_thresholds` rows (H-7, H-3, H-1, H-0) with `is_default = true`.
2. User can edit/add/remove these thresholds anytime from the task detail page.
3. A scheduled job (cron, **runs at least every hour**) checks all active tasks (`status != done`) whose time has reached one of the thresholds and that don't yet have a `notification_deliveries` row with status `sent` for that task + threshold + channel combination.
4. For each match: create a `notification_deliveries` entry with status `pending`, then process delivery (email via Resend + insert in-app notification). Update status to `sent` on success, or `failed` on failure (e.g. a Resend error) — so it can be retried on the next run.

## 8. Non-Functional Requirements

- Responsive (accessible on both desktop and mobile browsers).
- Each user's data is isolated (RLS in Supabase).
- **TBD:** is a PWA / installable app needed for a better mobile experience?

## 9. Out of Scope (Next Phase / Future Ideas)

The following features are **intentionally excluded from the MVP**, noted as candidates for a later phase:
- Priority level per task (urgent/normal/relaxed)
- Google OAuth & magic link login
- Collaboration/sharing tasks between users (e.g. for group assignments)
- External calendar integration (Google Calendar, etc.)
- Recurring tasks
- Native mobile app

## 10. Open Questions / Decisions Needed

- [x] Final scheduler runner for Elysia `/api/cron/evaluate-reminders` (decision: one instance, managed HTTP cron — Railway / Cron-job.org / UptimeRobot; requirement: at least hourly). See `docs/MVP.md` §7 and `docs/ARCHITECTURE.md` §2.6.
- [ ] Final hosting: Vercel or something else?
- [ ] Size limit & allowed file types for attachments (`type = file`)?
- [ ] Is a PWA / installable app needed?

## 11. Success Metrics (optional, fill in if relevant)

- % of tasks completed before the deadline (compared to before using the app, subjective).
- Retention: user returns to check the Summary weekly.
