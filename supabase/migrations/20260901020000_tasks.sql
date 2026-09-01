-- Issue #6: tasks + reminder_thresholds, default-threshold trigger, soft delete, owner RLS.
-- Apply in Supabase SQL Editor (or via supabase db push when CLI is wired).
-- Hard DELETE is denied under RLS; app soft-deletes via UPDATE of deleted_at.
-- Past thresholds are still stored; the scheduler (#9) skips firing them retroactively.

do $$ begin
  create type public.task_status as enum ('todo', 'in_progress', 'done');
exception
  when duplicate_object then null;
end $$;

create table if not exists public.tasks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  course_id uuid not null references public.courses (id) on delete cascade,
  title text not null check (char_length(trim(title)) > 0),
  description text,
  deadline timestamptz not null,
  status public.task_status not null default 'todo',
  estimated_duration integer check (
    estimated_duration is null or estimated_duration > 0
  ),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create index if not exists idx_tasks_user_id on public.tasks (user_id);
create index if not exists idx_tasks_course_id on public.tasks (course_id);
create index if not exists idx_tasks_deadline on public.tasks (deadline);
create index if not exists idx_tasks_status on public.tasks (status);
create index if not exists idx_tasks_user_id_active
  on public.tasks (user_id)
  where deleted_at is null;

create table if not exists public.reminder_thresholds (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references public.tasks (id) on delete cascade,
  days_before integer not null check (days_before >= 0),
  is_default boolean not null default false,
  created_at timestamptz not null default now(),
  unique (task_id, days_before)
);

create index if not exists idx_reminder_thresholds_task_id
  on public.reminder_thresholds (task_id);

create or replace function public.generate_default_thresholds()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.reminder_thresholds (task_id, days_before, is_default)
  values
    (new.id, 7, true),
    (new.id, 3, true),
    (new.id, 1, true),
    (new.id, 0, true);
  return new;
end;
$$;

drop trigger if exists on_task_created on public.tasks;
create trigger on_task_created
  after insert on public.tasks
  for each row execute function public.generate_default_thresholds();

alter table public.tasks enable row level security;
alter table public.reminder_thresholds enable row level security;

drop policy if exists "tasks_all_own" on public.tasks;
drop policy if exists "tasks_select_own" on public.tasks;
drop policy if exists "tasks_insert_own" on public.tasks;
drop policy if exists "tasks_update_own" on public.tasks;

create policy "tasks_select_own"
  on public.tasks
  for select
  using (user_id = auth.uid());

create policy "tasks_insert_own"
  on public.tasks
  for insert
  with check (user_id = auth.uid());

create policy "tasks_update_own"
  on public.tasks
  for update
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- Intentionally no DELETE policy: hard delete is forbidden; use soft delete.

drop policy if exists "thresholds_all_own" on public.reminder_thresholds;
drop policy if exists "thresholds_select_own" on public.reminder_thresholds;
drop policy if exists "thresholds_insert_own" on public.reminder_thresholds;
drop policy if exists "thresholds_update_own" on public.reminder_thresholds;
drop policy if exists "thresholds_delete_own" on public.reminder_thresholds;

create policy "thresholds_select_own"
  on public.reminder_thresholds
  for select
  using (
    task_id in (select id from public.tasks where user_id = auth.uid())
  );

create policy "thresholds_insert_own"
  on public.reminder_thresholds
  for insert
  with check (
    task_id in (select id from public.tasks where user_id = auth.uid())
  );

create policy "thresholds_update_own"
  on public.reminder_thresholds
  for update
  using (
    task_id in (select id from public.tasks where user_id = auth.uid())
  )
  with check (
    task_id in (select id from public.tasks where user_id = auth.uid())
  );

create policy "thresholds_delete_own"
  on public.reminder_thresholds
  for delete
  using (
    task_id in (select id from public.tasks where user_id = auth.uid())
  );
