-- Test suite for P3 list indexes (attachments task lookup, course-filtered tasks)
-- Run in a transaction and rollback at the end.

begin;

-- 1. Verify that migration executes idempotently
\ir ../migrations/20260921020000_p3_list_indexes.sql

-- 2. Verify the new indexes exist in pg_indexes
do $$
begin
  if not exists(
    select 1 from pg_indexes
    where schemaname = 'public'
      and tablename = 'attachments'
      and indexname = 'idx_attachments_task_id'
  ) then
    raise exception 'idx_attachments_task_id does not exist on attachments';
  end if;

  if not exists(
    select 1 from pg_indexes
    where schemaname = 'public'
      and tablename = 'tasks'
      and indexname = 'idx_tasks_user_course_deadline_active'
  ) then
    raise exception 'idx_tasks_user_course_deadline_active does not exist on tasks';
  end if;
end $$;

-- 3. Verify query semantics with test data (bypass RLS as service role would;
--    these are planner/shape checks, not policy checks)
do $$
declare
  t_user_id uuid := gen_random_uuid();
  t_course_id uuid;
  t_task_id uuid;
  ret_count int;
begin
  -- Identity chain: courses.user_id FKs profiles.id FKs auth.users.id
  -- (profiles row is auto-created by on_auth_user_created).
  insert into auth.users (id, email)
    values (t_user_id, 'p3-' || t_user_id::text || '@example.com');
  insert into courses (user_id, name) values (t_user_id, 'P3 Course')
    returning id into t_course_id;
  insert into tasks (user_id, course_id, title, deadline)
    values (t_user_id, t_course_id, 'P3 Task', now() + interval '7 days')
    returning id into t_task_id;
  insert into attachments (task_id, type, url)
    values (t_task_id, 'link', 'https://example.com/p3');

  -- Task-scoped attachment lookup (detail view path)
  select count(*) into ret_count
  from attachments
  where task_id = t_task_id;
  if ret_count != 1 then
    raise exception 'Expected 1 attachment for task, got %', ret_count;
  end if;

  -- Course-filtered active task list (course detail path)
  select count(*) into ret_count
  from tasks
  where user_id = t_user_id
    and deleted_at is null
    and course_id = t_course_id;
  if ret_count != 1 then
    raise exception 'Expected 1 task for course filter, got %', ret_count;
  end if;

  -- Date-windowed course list (calendar/month + P2-2 dueFrom/dueTo path)
  select count(*) into ret_count
  from tasks
  where user_id = t_user_id
    and deleted_at is null
    and course_id = t_course_id
    and deadline >= now()
    and deadline < now() + interval '30 days';
  if ret_count != 1 then
    raise exception 'Expected 1 task for windowed course filter, got %', ret_count;
  end if;
end $$;

rollback;
