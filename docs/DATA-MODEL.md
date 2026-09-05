# Deadline Radar — Data Model

> **Source of truth:** `product.md` (Baseline v0.1) + `DOMAIN.md`
> Target: Supabase PostgreSQL
> Access path: Elysia API queries via **Drizzle** (`packages/db`) using `DATABASE_URL`. RLS policies below remain **defense-in-depth**; the API is the primary authorization boundary (scoped by authenticated `user_id`).

---

## 1. Entity Relationship Overview

```
auth.users (Supabase managed)
     │ 1:1
     ▼
  profiles
     │
     ├── 1:N ──▶ courses
     │                │
     │                │ 1:N
     ▼                ▼
   tasks ◀────────────┘
     │
     ├── 1:N ──▶ reminder_thresholds ──┐
     │                                  │ 1:N
     ├── 1:N ──▶ attachments            ▼
     │                         notification_deliveries
     └── (status, deadline, etc.)

auth_audit_events  (append-only; soft-linked user_id, no FK)
```

## 2. Enums

```sql
create type task_status as enum ('todo', 'in_progress', 'done');
create type notification_channel as enum ('email', 'in_app');
create type notification_status as enum ('pending', 'sent', 'failed');
create type attachment_type as enum ('file', 'link');
```

## 3. Tables (DDL)

### profiles
*1:1 with `auth.users` — not a separate `users` table.*

```sql
create table profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  name text,
  timezone text not null default 'UTC',
  created_at timestamptz not null default now()
);
```

### auth_audit_events
*Append-only authentication audit trail. Written by the API service role. No RLS client policies. Never store passwords, tokens, or secrets.*

```sql
create table auth_audit_events (
  id uuid primary key default gen_random_uuid(),
  event text not null,
  user_id uuid,
  session_id text,
  result text not null check (result in ('success', 'failure', 'denied')),
  method text,
  ip text,
  user_agent text,
  request_id text,
  metadata jsonb,
  created_at timestamptz not null default now()
);
```

### courses

```sql
create table courses (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles(id) on delete cascade,
  name text not null check (char_length(trim(name)) > 0),
  code text,
  color text,
  created_at timestamptz not null default now(),
  deleted_at timestamptz
);

create index idx_courses_user_id on courses(user_id);
create index idx_courses_user_id_active on courses(user_id) where deleted_at is null;
```

> Soft delete: set `deleted_at` instead of removing the row. Active queries filter `deleted_at is null`. Course `name` is not unique per user; identity is `id`. Retention / purge of soft-deleted rows is an open domain question (see `DOMAIN.md` §7).

### tasks

```sql
create table tasks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles(id) on delete cascade,
  course_id uuid not null references courses(id) on delete cascade,
  title text not null,
  description text,
  deadline timestamptz not null,
  status task_status not null default 'todo',
  estimated_duration integer, -- unit: minutes (product.md §10 still lists free text as an alternate)
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create index idx_tasks_user_id on tasks(user_id);
create index idx_tasks_course_id on tasks(course_id);
create index idx_tasks_deadline on tasks(deadline);
create index idx_tasks_status on tasks(status);
create index idx_tasks_user_id_active on tasks(user_id) where deleted_at is null;
```

> Soft delete: set `deleted_at` instead of removing the row. Active queries filter `deleted_at is null`. Hard DELETE is denied under RLS (same pattern as courses). Retention / purge of soft-deleted rows is an open domain question (see `DOMAIN.md` §7).

### reminder_thresholds

```sql
create table reminder_thresholds (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references tasks(id) on delete cascade,
  days_before integer not null check (days_before >= 0),
  is_default boolean not null default false,
  created_at timestamptz not null default now(),
  unique (task_id, days_before)
);

create index idx_reminder_thresholds_task_id on reminder_thresholds(task_id);
```

### notification_deliveries
*(previously named `reminder_logs` in the early `product.md` draft)*

```sql
create table notification_deliveries (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references tasks(id) on delete cascade,
  threshold_id uuid not null references reminder_thresholds(id) on delete cascade,
  channel notification_channel not null,
  status notification_status not null default 'pending',
  retry_count integer not null default 0, -- see DOMAIN.md §7 (open question: max retry)
  sent_at timestamptz,
  read_at timestamptz, -- only relevant for channel = in_app
  created_at timestamptz not null default now(),
  unique (threshold_id, channel)
);

create index idx_notification_deliveries_task_id on notification_deliveries(task_id);
create index idx_notification_deliveries_status on notification_deliveries(status);
```

### attachments

```sql
create table attachments (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references tasks(id) on delete cascade,
  type attachment_type not null,
  name text not null,
  storage_path text,
  url text,
  created_at timestamptz not null default now(),
  constraint attachment_source_check check (
    (type = 'file' and storage_path is not null and url is null) or
    (type = 'link' and url is not null and storage_path is null)
  )
);

create index idx_attachments_task_id on attachments(task_id);
```

## 4. Triggers / Functions (sketch)

### 4.1 Auto-create a profile when a user registers
```sql
create function handle_new_user()
returns trigger as $$
begin
  insert into public.profiles (id, email)
  values (new.id, new.email);
  return new;
end;
$$ language plpgsql security definer;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function handle_new_user();
```

### 4.2 Auto-generate default reminder thresholds when a task is created
```sql
create function generate_default_thresholds()
returns trigger as $$
begin
  insert into reminder_thresholds (task_id, days_before, is_default)
  values
    (new.id, 7, true),
    (new.id, 3, true),
    (new.id, 1, true),
    (new.id, 0, true);
  return new;
end;
$$ language plpgsql security definer;

create trigger on_task_created
  after insert on tasks
  for each row execute function generate_default_thresholds();
```

> Note: per `DOMAIN.md` §4, thresholds whose trigger time has already passed when the task is created are **still stored** in this table (not deleted) — it's the scheduler job's responsibility to skip such thresholds during evaluation (not handled at the DB trigger level).

## 5. Row Level Security (RLS) — policy sketch

```sql
alter table profiles enable row level security;
alter table courses enable row level security;
alter table tasks enable row level security;
alter table reminder_thresholds enable row level security;
alter table notification_deliveries enable row level security;
alter table attachments enable row level security;

-- profiles: user can only access their own row
create policy "profiles_select_own" on profiles for select using (id = auth.uid());
create policy "profiles_update_own" on profiles for update using (id = auth.uid());

-- courses: owner scoped; soft delete via UPDATE deleted_at (no DELETE policy)
create policy "courses_select_own" on courses for select using (user_id = auth.uid());
create policy "courses_insert_own" on courses for insert with check (user_id = auth.uid());
create policy "courses_update_own" on courses for update
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- tasks: owner scoped; soft delete via UPDATE deleted_at (no DELETE policy)
create policy "tasks_select_own" on tasks for select using (user_id = auth.uid());
create policy "tasks_insert_own" on tasks for insert with check (user_id = auth.uid());
create policy "tasks_update_own" on tasks for update
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- reminder_thresholds: scoped via a join to tasks
create policy "thresholds_select_own" on reminder_thresholds for select using (
  task_id in (select id from tasks where user_id = auth.uid())
);
create policy "thresholds_insert_own" on reminder_thresholds for insert with check (
  task_id in (select id from tasks where user_id = auth.uid())
);
create policy "thresholds_update_own" on reminder_thresholds for update
  using (task_id in (select id from tasks where user_id = auth.uid()))
  with check (task_id in (select id from tasks where user_id = auth.uid()));
create policy "thresholds_delete_own" on reminder_thresholds for delete using (
  task_id in (select id from tasks where user_id = auth.uid())
);

-- attachments: scoped via a join to tasks
create policy "attachments_all_own" on attachments for all using (
  task_id in (select id from tasks where user_id = auth.uid())
);

-- notification_deliveries: user may only SELECT & update their own read_at;
-- insert/update of status is done by the scheduler job using service_role (bypasses RLS)
create policy "deliveries_select_own" on notification_deliveries for select using (
  task_id in (select id from tasks where user_id = auth.uid())
);
create policy "deliveries_update_read_own" on notification_deliveries for update using (
  task_id in (select id from tasks where user_id = auth.uid())
);
```

## 6. Open Data Model Questions
- [ ] Final data type for `estimated_duration` (integer minutes vs free text) — see `product.md` §10. Schema currently uses integer minutes.
- [ ] Is `retry_count` on `notification_deliveries` enough, or is a `last_error` (text) column needed for debugging Resend failures?
- [ ] Soft-delete retention / automatic purge for `courses.deleted_at` and `tasks.deleted_at` — no policy yet; see `DOMAIN.md` §7.
