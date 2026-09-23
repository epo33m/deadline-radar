-- M5-M-8 & M5-M-9: Integrity check constraints and composite/filtered indexes.

-- 1. Tasks completed_at integrity
update public.tasks
  set completed_at = coalesce(updated_at, created_at, now())
  where status = 'done' and completed_at is null;

update public.tasks
  set completed_at = null
  where status != 'done' and completed_at is not null;

alter table public.tasks
  drop constraint if exists tasks_completed_at_status_check;

alter table public.tasks
  add constraint tasks_completed_at_status_check check (
    (status = 'done' and completed_at is not null) or
    (status != 'done' and completed_at is null)
  );

-- 2. Courses hex color & length constraints
alter table public.courses
  drop constraint if exists courses_color_hex_check;

alter table public.courses
  add constraint courses_color_hex_check check (
    color is null or color ~* '^#[0-9a-f]{6}$'
  );

alter table public.courses
  drop constraint if exists courses_name_length_check;

alter table public.courses
  add constraint courses_name_length_check check (
    char_length(name) <= 255
  );

alter table public.courses
  drop constraint if exists courses_code_length_check;

alter table public.courses
  add constraint courses_code_length_check check (
    code is null or char_length(code) <= 50
  );

-- 3. Tasks title length constraint
alter table public.tasks
  drop constraint if exists tasks_title_length_check;

alter table public.tasks
  add constraint tasks_title_length_check check (
    char_length(title) <= 255
  );

-- 4. Composite & filtered indexes for hot queries
create index if not exists idx_tasks_user_deadline_active
  on public.tasks (user_id, deadline)
  where deleted_at is null;

create index if not exists idx_tasks_user_status_active
  on public.tasks (user_id, status)
  where deleted_at is null;

create index if not exists idx_courses_user_created_active
  on public.courses (user_id, created_at)
  where deleted_at is null;

create index if not exists idx_notification_deliveries_status_created
  on public.notification_deliveries (status, created_at);
