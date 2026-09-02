# Deadline Radar — Architecture

> **Source of truth:** `product.md` (Baseline v0.1) + `DOMAIN.md`

---

## 1. High-Level Architecture

```
┌─────────────┐        ┌──────────────────────────┐       ┌──────────┐
│   Browser   │◀──────▶│   Next.js App (Vercel?)  │──────▶│  Resend  │
│ (user)      │        │   App Router + RSC       │       │ (email)  │
└─────────────┘        └────────────┬─────────────┘       └──────────┘
                                     │
                                     ▼
                        ┌────────────────────────┐
                        │        Supabase         │
                        │  Postgres + Auth +      │
                        │  Storage + RLS          │
                        └────────────┬────────────┘
                                     ▲
                                     │ (triggers evaluation, hourly)
                        ┌────────────────────────┐
                        │   Scheduler (TBD)       │
                        │  pg_cron / Vercel Cron  │
                        └────────────────────────┘
```

## 2. Components

### 2.1 Frontend — Next.js (App Router)
Main pages (indicative, may change during implementation):
- `/login`, `/register`
- `/dashboard` — summary of tasks approaching deadline, overdue, and recently completed
- `/courses` — course CRUD
- `/tasks`, `/tasks/[id]` — task list & detail/edit (incl. threshold & attachment management)
- `/calendar` — calendar view
- `/preferences` — account and time zone
- `/preferences/notifications` — in-app notification history (opened from the header bell)
- Header bell — unread count + link to `/preferences/notifications`

Server Components for data fetching (via the Supabase server client), Client Components for interactive parts (forms, calendar widget, bell icon dropdown). Form validation uses Zod schemas shared between the client and server actions.

### 2.2 Backend / API Layer
- Most CRUD operations **don't need a custom API route** — they go directly through the Supabase client (server actions/RSC), protected by RLS.
- One dedicated endpoint for reminder evaluation: `/api/cron/evaluate-reminders` (Next.js Route Handler) — or the equivalent Supabase Edge Function, depending on the scheduler choice (§6).
- Supabase Auth manages sessions (via the `@supabase/ssr` helper for Next.js).

### 2.3 Database — Supabase Postgres
- Tables: `profiles`, `courses`, `tasks`, `reminder_thresholds`, `notification_deliveries`, `attachments` (full detail in `DATA-MODEL.md`).
- RLS enabled on all tables, scoped to `auth.uid()`.
- **Trigger 1:** `on auth.users insert → auto-create profiles row`.
- **Trigger 2:** `on tasks insert → auto-generate 4 reminder_thresholds (H-7/H-3/H-1/H-0)`, per the rule in `DOMAIN.md`.

### 2.4 Storage — Supabase Storage
- One bucket (e.g. `attachments`), **private**, access controlled via RLS/signed URLs.
- Path convention: `attachments/{user_id}/{task_id}/{filename}`.
- When a task is deleted → its related files in storage also need to be cleaned up (via an Edge Function trigger or a cleanup job — **implementation detail TBD**).

### 2.5 Email — Resend
- Sends reminder emails per `notification_deliveries` row with status `pending` and `channel = email`.
- MVP: a single email template with a dynamic urgency label (e.g. "H-7", "H-0 — today!"). A separate template per tier can be a future improvement.

### 2.6 Scheduler — two candidates (not yet decided)

| | **Option A: Supabase pg_cron + Edge Function** | **Option B: Vercel Cron + Next.js API route** |
|---|---|---|
| Execution location | Within the Supabase ecosystem | Within the Vercel/Next.js ecosystem |
| Pros | Close to the DB, no Next.js cold-start, works even if hosting isn't Vercel | Easier to debug since it's the same language/codebase as the app, easy to trigger manually |
| Cons | Requires writing a separate Edge Function (Deno runtime) | Depends on Vercel Cron (subject to plan/limits) |
| Requirement | Runs at least every hour | Runs at least every hour |

> Final decision pending the hosting decision (`product.md` §10).

## 3. Data Flow: Reminder Evaluation (per run)

1. Scheduler triggers the job (hourly).
2. The job (using the `service_role` key, bypassing RLS) queries all `tasks` with `status != done` that have `reminder_thresholds` that are "due" (see the trigger-time rule in `DOMAIN.md` §4) and don't yet have a `notification_deliveries` row (`sent`/`pending`) for that combination.
3. For each match: insert 2 `notification_deliveries` rows (`email` + `in_app`), status `pending`.
4. Process the `email` delivery → call the Resend API → update status to `sent`/`failed`.
5. Process the `in_app` delivery → the insert itself already counts as `sent` (immediately available for the user to read).
6. The `/dashboard` client & bell icon display new notifications — MVP uses simple polling; Supabase Realtime can be an upgrade later (§7).

## 4. Auth & Security

- Supabase Auth, email/password for MVP (`product.md` §5.1).
- RLS policy overview (details in `DATA-MODEL.md` §5):
  - `profiles`: user can only access their own row.
  - `courses`, `tasks`, `attachments`, `reminder_thresholds`: scoped to the owner (directly via `user_id` or via a join to `tasks`).
  - `notification_deliveries`: insert/update only via `service_role` (the scheduler job); the user can only `select` and update `read_at` for their own rows.
- Environment variables:
  - `NEXT_PUBLIC_SUPABASE_URL`
  - `NEXT_PUBLIC_SUPABASE_ANON_KEY`
  - `SUPABASE_SERVICE_ROLE_KEY` (server-only, used by the scheduler job for cross-user evaluation)
  - `RESEND_API_KEY`

## 5. Folder Structure (proposed)

```
/app
  /(auth)/login
  /(auth)/register
  /(dashboard)/dashboard
  /(dashboard)/courses
  /(dashboard)/tasks
  /(dashboard)/tasks/[id]
  /(dashboard)/calendar
  /(dashboard)/preferences
  /(dashboard)/preferences/notifications
  /api/cron/evaluate-reminders/route.ts
/components
  /ui        (shadcn/ui components)
  /tasks
  /courses
  /notifications
  /preferences
/lib
  /supabase  (client.ts, server.ts)
  /validation (zod schemas)
  /email     (resend templates/helpers)
/types
```

## 6. Deployment
- Hosting: **TBD** (`product.md` §10).
- CI/CD: **TBD** — default assumption: auto-deploy from git if hosting = Vercel.

## 7. Open Architecture Questions
- [ ] Final scheduler choice: Option A vs Option B.
- [ ] Final hosting choice.
- [ ] Realtime notifications (Supabase Realtime) vs simple polling for MVP — suggestion: start with polling, upgrade later.
- [ ] Cleanup strategy for storage files when a task/attachment is deleted.
- [ ] Max retry attempts & backoff for failed email deliveries (related to `DOMAIN.md` §7).
