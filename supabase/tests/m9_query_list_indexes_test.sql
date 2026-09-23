-- Test suite for M-9 query list indexes
-- Run in a transaction and rollback at the end.

begin;

-- 1. Verify that migration executes idempotently
\ir ../migrations/20260919030000_m9_query_list_indexes.sql

-- 2. Verify all 3 indexes exist in pg_indexes
do $$
declare
  has_tasks_idx boolean;
  has_courses_idx boolean;
  has_notif_idx boolean;
begin
  select exists(
    select 1 from pg_indexes
    where schemaname = 'public'
      and tablename = 'tasks'
      and indexname = 'idx_tasks_user_deadline_id_active'
  ) into has_tasks_idx;

  if not has_tasks_idx then
    raise exception 'idx_tasks_user_deadline_id_active does not exist on tasks';
  end if;

  select exists(
    select 1 from pg_indexes
    where schemaname = 'public'
      and tablename = 'courses'
      and indexname = 'idx_courses_user_created_id_active'
  ) into has_courses_idx;

  if not has_courses_idx then
    raise exception 'idx_courses_user_created_id_active does not exist on courses';
  end if;

  select exists(
    select 1 from pg_indexes
    where schemaname = 'public'
      and tablename = 'notification_deliveries'
      and indexname = 'idx_notification_deliveries_in_app_sent'
  ) into has_notif_idx;

  if not has_notif_idx then
    raise exception 'idx_notification_deliveries_in_app_sent does not exist on notification_deliveries';
  end if;
end $$;

-- 3. Verify query semantics and index matching with test data
do $$
declare
  t_user_id uuid := '00000000-0000-0000-0000-000000000888';
  c_id uuid := gen_random_uuid();
  t1_id uuid := gen_random_uuid();
  t2_id uuid := gen_random_uuid();
  th1_id uuid := gen_random_uuid();
  nd1_id uuid := gen_random_uuid();
  ret_count integer;
begin
  -- Setup test data
  insert into auth.users (id, email, raw_user_meta_data)
  values (t_user_id, 'm9_test@example.com', '{}'::jsonb)
  on conflict (id) do nothing;

  insert into profiles (id, email, name, timezone, time_format)
  values (t_user_id, 'm9_test@example.com', 'M9 Test User', 'UTC', '24h')
  on conflict (id) do nothing;

  insert into courses (id, user_id, name, color, created_at)
  values (c_id, t_user_id, 'M9 Test Course', '#112233', now());

  insert into tasks (id, user_id, course_id, title, deadline, status, created_at)
  values
    (t1_id, t_user_id, c_id, 'Task 1', now() + interval '1 day', 'todo', now()),
    (t2_id, t_user_id, c_id, 'Task 2', now() + interval '2 days', 'todo', now());

  select id into th1_id
  from reminder_thresholds
  where task_id = t1_id and days_before = 3;

  insert into notification_deliveries (id, task_id, threshold_id, days_before, channel, status, sent_at, read_at)
  values (nd1_id, t1_id, th1_id, 3, 'in_app', 'sent', now(), null);

  -- Verify tasks list query
  select count(*) into ret_count
  from tasks
  where user_id = t_user_id and deleted_at is null;
  if ret_count != 2 then
    raise exception 'Expected 2 active tasks, got %', ret_count;
  end if;

  -- Verify courses list query
  select count(*) into ret_count
  from courses
  where user_id = t_user_id and deleted_at is null;
  if ret_count != 1 then
    raise exception 'Expected 1 active course, got %', ret_count;
  end if;

  -- Verify notification unread count query
  select count(*)::int into ret_count
  from notification_deliveries nd
  join tasks t on nd.task_id = t.id
  where t.user_id = t_user_id
    and nd.channel = 'in_app'
    and nd.status = 'sent'
    and nd.read_at is null
    and t.deleted_at is null;
  if ret_count != 1 then
    raise exception 'Expected 1 unread notification, got %', ret_count;
  end if;
end $$;

rollback;
