-- ============================================================================
-- M-8 regression test: database integrity constraints
-- ============================================================================
-- Proves against PostgreSQL that:
--   1. Tasks -> Courses composite ownership FK is enforced
--   2. Tasks status ↔ completed_at invariant is enforced
--   3. Courses color #RRGGBB format is enforced
--   4. Text length limits (title, name, code, description) are enforced
--   5. Reminder thresholds range (0 <= days_before <= 36500) is enforced
--   6. The migration is idempotent
--   7. Leaves no test data behind (rolled back)
-- ============================================================================

\set ON_ERROR_STOP on

-- ---------------------------------------------------------------------------
-- 0. Apply migration under test twice (proves idempotency) in-transaction
-- ---------------------------------------------------------------------------
\echo '>>> 0. applying migration under test twice (idempotency)'

begin;

\ir ../migrations/20260919020000_m8_database_integrity_constraints.sql
\ir ../migrations/20260919020000_m8_database_integrity_constraints.sql

-- ---------------------------------------------------------------------------
-- 1. Constraint presence verification
-- ---------------------------------------------------------------------------
\echo '>>> 1. verifying constraints existence'

do $assert$
declare
  v_chk text;
begin
  -- 1. courses_id_user_id_key
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.courses'::regclass
      and conname = 'courses_id_user_id_key'
  ) then
    raise exception 'M8 ASSERTION FAILED: courses_id_user_id_key missing';
  end if;

  -- 2. tasks_course_id_user_id_fkey
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.tasks'::regclass
      and conname = 'tasks_course_id_user_id_fkey'
  ) then
    raise exception 'M8 ASSERTION FAILED: tasks_course_id_user_id_fkey missing';
  end if;

  -- 3. tasks_completed_at_status_check
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.tasks'::regclass
      and conname = 'tasks_completed_at_status_check'
  ) then
    raise exception 'M8 ASSERTION FAILED: tasks_completed_at_status_check missing';
  end if;

  -- 4. courses_color_hex_check
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.courses'::regclass
      and conname = 'courses_color_hex_check'
  ) then
    raise exception 'M8 ASSERTION FAILED: courses_color_hex_check missing';
  end if;

  -- 5. courses_name_length_check
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.courses'::regclass
      and conname = 'courses_name_length_check'
  ) then
    raise exception 'M8 ASSERTION FAILED: courses_name_length_check missing';
  end if;

  -- 6. courses_code_length_check
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.courses'::regclass
      and conname = 'courses_code_length_check'
  ) then
    raise exception 'M8 ASSERTION FAILED: courses_code_length_check missing';
  end if;

  -- 7. courses_description_length_check
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.courses'::regclass
      and conname = 'courses_description_length_check'
  ) then
    raise exception 'M8 ASSERTION FAILED: courses_description_length_check missing';
  end if;

  -- 8. tasks_title_length_check
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.tasks'::regclass
      and conname = 'tasks_title_length_check'
  ) then
    raise exception 'M8 ASSERTION FAILED: tasks_title_length_check missing';
  end if;

  -- 9. tasks_description_length_check
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.tasks'::regclass
      and conname = 'tasks_description_length_check'
  ) then
    raise exception 'M8 ASSERTION FAILED: tasks_description_length_check missing';
  end if;

  -- 10. reminder_thresholds_days_before_check
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.reminder_thresholds'::regclass
      and conname = 'reminder_thresholds_days_before_check'
  ) then
    raise exception 'M8 ASSERTION FAILED: reminder_thresholds_days_before_check missing';
  end if;

  raise notice 'PASS  All 10 constraints successfully verified in PostgreSQL metadata';
end $assert$;

-- ---------------------------------------------------------------------------
-- 2. Invariant tests with data fixtures
-- ---------------------------------------------------------------------------
\echo '>>> 2. running behavior and constraint enforcement tests'

do $fixture$
declare
  v_user_a uuid;
  v_user_b uuid;
  v_course_a uuid;
  v_course_b uuid;
  v_task_a uuid;
  v_err text;
begin
  -- User A & Course A
  insert into auth.users (id, email)
  values (gen_random_uuid(), 'm8-user-a@example.invalid')
  returning id into v_user_a;

  insert into public.courses (user_id, name, code, color, description)
  values (v_user_a, 'Course A', 'CS101', '#0066cc', 'A valid description')
  returning id into v_course_a;

  -- User B & Course B
  insert into auth.users (id, email)
  values (gen_random_uuid(), 'm8-user-b@example.invalid')
  returning id into v_user_b;

  insert into public.courses (user_id, name, code, color)
  values (v_user_b, 'Course B', 'CS102', null)
  returning id into v_course_b;

  -- A. Ownership: Cross-owner insert rejected
  v_err := null;
  begin
    insert into public.tasks (user_id, course_id, title, deadline, status, completed_at)
    values (v_user_a, v_course_b, 'Task Cross', now() + interval '1 day', 'todo', null);
  exception when foreign_key_violation then
    v_err := sqlerrm;
  end;
  if v_err is null then
    raise exception 'M8 ASSERTION FAILED: cross-owner task insert was allowed';
  end if;
  raise notice 'PASS  A. Ownership: Cross-owner insert rejected by composite FK';

  -- B. Completed_at ↔ Status Invariant
  -- B1: done with completed_at -> SUCCESS
  insert into public.tasks (user_id, course_id, title, deadline, status, completed_at)
  values (v_user_a, v_course_a, 'Task Done Valid', now() + interval '1 day', 'done', now())
  returning id into v_task_a;

  -- B2: done with NULL completed_at -> REJECTED
  v_err := null;
  begin
    insert into public.tasks (user_id, course_id, title, deadline, status, completed_at)
    values (v_user_a, v_course_a, 'Task Done Invalid', now() + interval '1 day', 'done', null);
  exception when check_violation then
    v_err := sqlerrm;
  end;
  if v_err is null then
    raise exception 'M8 ASSERTION FAILED: done task with NULL completed_at was allowed';
  end if;

  -- B3: todo with completed_at -> REJECTED
  v_err := null;
  begin
    insert into public.tasks (user_id, course_id, title, deadline, status, completed_at)
    values (v_user_a, v_course_a, 'Task Todo Invalid', now() + interval '1 day', 'todo', now());
  exception when check_violation then
    v_err := sqlerrm;
  end;
  if v_err is null then
    raise exception 'M8 ASSERTION FAILED: todo task with non-null completed_at was allowed';
  end if;
  raise notice 'PASS  B. Status ↔ completed_at: Invariant strictly enforced in both directions';

  -- C. Course Color Hex
  -- C1: invalid color 'blue' -> REJECTED
  v_err := null;
  begin
    insert into public.courses (user_id, name, color)
    values (v_user_a, 'Invalid Color Course', 'blue');
  exception when check_violation then
    v_err := sqlerrm;
  end;
  if v_err is null then
    raise exception 'M8 ASSERTION FAILED: non-hex course color was allowed';
  end if;

  -- C2: 3-char hex '#fff' -> REJECTED (app uses canonical 6-digit hex)
  v_err := null;
  begin
    insert into public.courses (user_id, name, color)
    values (v_user_a, 'Short Hex Course', '#fff');
  exception when check_violation then
    v_err := sqlerrm;
  end;
  if v_err is null then
    raise exception 'M8 ASSERTION FAILED: 3-char hex was allowed';
  end if;
  raise notice 'PASS  C. Color: Hex format #RRGGBB check strictly enforced';

  -- D. Text Length Limits
  -- D1: task title > 255 chars -> REJECTED
  v_err := null;
  begin
    insert into public.tasks (user_id, course_id, title, deadline, status, completed_at)
    values (v_user_a, v_course_a, repeat('a', 256), now() + interval '1 day', 'todo', null);
  exception when check_violation then
    v_err := sqlerrm;
  end;
  if v_err is null then
    raise exception 'M8 ASSERTION FAILED: task title > 255 was allowed';
  end if;

  -- D2: task description > 5000 chars -> REJECTED
  v_err := null;
  begin
    insert into public.tasks (user_id, course_id, title, description, deadline, status, completed_at)
    values (v_user_a, v_course_a, 'Task Valid Title', repeat('d', 5001), now() + interval '1 day', 'todo', null);
  exception when check_violation then
    v_err := sqlerrm;
  end;
  if v_err is null then
    raise exception 'M8 ASSERTION FAILED: task description > 5000 was allowed';
  end if;

  -- D3: course name > 255 chars -> REJECTED
  v_err := null;
  begin
    insert into public.courses (user_id, name)
    values (v_user_a, repeat('c', 256));
  exception when check_violation then
    v_err := sqlerrm;
  end;
  if v_err is null then
    raise exception 'M8 ASSERTION FAILED: course name > 255 was allowed';
  end if;

  -- D4: course code > 50 chars -> REJECTED
  v_err := null;
  begin
    insert into public.courses (user_id, name, code)
    values (v_user_a, 'Valid Name', repeat('x', 51));
  exception when check_violation then
    v_err := sqlerrm;
  end;
  if v_err is null then
    raise exception 'M8 ASSERTION FAILED: course code > 50 was allowed';
  end if;

  -- D5: course description > 5000 chars -> REJECTED
  v_err := null;
  begin
    insert into public.courses (user_id, name, description)
    values (v_user_a, 'Valid Name', repeat('y', 5001));
  exception when check_violation then
    v_err := sqlerrm;
  end;
  if v_err is null then
    raise exception 'M8 ASSERTION FAILED: course description > 5000 was allowed';
  end if;
  raise notice 'PASS  D. Text lengths: Bounds on title, name, code, descriptions strictly enforced';

  -- E. Reminder Thresholds range (0 <= days_before <= 36500)
  -- E1: negative days_before -> REJECTED
  v_err := null;
  begin
    insert into public.reminder_thresholds (task_id, days_before)
    values (v_task_a, -1);
  exception when check_violation then
    v_err := sqlerrm;
  end;
  if v_err is null then
    raise exception 'M8 ASSERTION FAILED: negative days_before was allowed';
  end if;

  -- E2: days_before > 36500 -> REJECTED
  v_err := null;
  begin
    insert into public.reminder_thresholds (task_id, days_before)
    values (v_task_a, 36501);
  exception when check_violation then
    v_err := sqlerrm;
  end;
  if v_err is null then
    raise exception 'M8 ASSERTION FAILED: days_before > 36500 was allowed';
  end if;

  -- E3: days_before = 36500 -> SUCCESS
  insert into public.reminder_thresholds (task_id, days_before)
  values (v_task_a, 36500);

  raise notice 'PASS  E. Reminder thresholds: Upper (36500) and lower (0) bounds strictly enforced';
end $fixture$;

-- ---------------------------------------------------------------------------
-- 3. Rollback
-- ---------------------------------------------------------------------------
\echo '>>> 3. rollback'
rollback;

\echo 'M8 REGRESSION TESTS PASSED'
