-- Issue #5: courses table with soft delete and owner RLS.
-- Apply in Supabase SQL Editor (or via supabase db push when CLI is wired).
-- Hard DELETE is denied under RLS; app soft-deletes via UPDATE of deleted_at.

create table if not exists public.courses (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  name text not null check (char_length(trim(name)) > 0),
  code text,
  color text,
  created_at timestamptz not null default now(),
  deleted_at timestamptz
);

create index if not exists idx_courses_user_id on public.courses (user_id);
create index if not exists idx_courses_user_id_active
  on public.courses (user_id)
  where deleted_at is null;

alter table public.courses enable row level security;

drop policy if exists "courses_all_own" on public.courses;
drop policy if exists "courses_select_own" on public.courses;
drop policy if exists "courses_insert_own" on public.courses;
drop policy if exists "courses_update_own" on public.courses;

create policy "courses_select_own"
  on public.courses
  for select
  using (user_id = auth.uid());

create policy "courses_insert_own"
  on public.courses
  for insert
  with check (user_id = auth.uid());

create policy "courses_update_own"
  on public.courses
  for update
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- Intentionally no DELETE policy: hard delete is forbidden; use soft delete.
