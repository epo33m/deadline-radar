-- H-2 implementation: composite FK task course owner invariant
-- Enforces tasks(course_id, user_id) -> courses(id, user_id) with ON DELETE CASCADE.
-- Adds UNIQUE (id, user_id) on public.courses.
-- Drops old single-column FK tasks_course_id_fkey.

-- 1. Drop existing FK constraints on tasks first (prevents dependency lock on courses unique key)
alter table public.tasks
  drop constraint if exists tasks_course_id_fkey,
  drop constraint if exists tasks_course_id_user_id_fkey;

-- 2. Add UNIQUE (id, user_id) on courses if not present (required target for composite FK)
do $$ begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.courses'::regclass
      and conname = 'courses_id_user_id_key'
  ) then
    alter table public.courses
      add constraint courses_id_user_id_key unique (id, user_id);
  end if;
end $$;

-- 3. Add composite FK on tasks
alter table public.tasks
  add constraint tasks_course_id_user_id_fkey
  foreign key (course_id, user_id)
  references public.courses (id, user_id)
  on delete cascade;
