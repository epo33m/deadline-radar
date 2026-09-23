-- ============================================================================
-- H-2 regression test: composite FK task course owner invariant
-- ============================================================================
-- Proves against a real PostgreSQL database that:
--   1. Valid same-owner task insert (User A + Course A + Task A) succeeds
--   2. Valid same-owner task insert (User B + Course B + Task B) succeeds
--   3. Invalid cross-owner insert (User A + Course B) is rejected (23503)
--   4. Invalid cross-owner insert (User B + Course A) is rejected (23503)
--   5. Invalid cross-owner UPDATE (Task A course_id -> Course B) is rejected
--   6. Invalid cross-owner UPDATE (Task A user_id -> User B) is rejected
--   7. Normal cascade: deleting Course A removes Task A
--   8. Cross-owner cascade safety: deleting Course B does NOT remove Task A
--   9. Existing clean data remains valid after applying the migration
--  10. The migration is idempotent (applied twice in transaction)
--  11. The test leaves NO data behind (all changes rolled back)
--
-- Usage:
--   export $(grep -v '^#' .env.local | xargs)
--   psql "$DATABASE_URL" -X -v ON_ERROR_STOP=1 \
--     -f supabase/tests/h2_task_course_owner_invariant.sql
-- ============================================================================

\set ON_ERROR_STOP on

-- ---------------------------------------------------------------------------
-- 0. Apply the migration under test, twice (proves idempotency), in-transaction
-- ---------------------------------------------------------------------------
\echo '>>> 0. applying migration under test twice (idempotency)'

begin;

\ir ../migrations/20260918010000_h2_task_course_owner_fk.sql
\ir ../migrations/20260918010000_h2_task_course_owner_fk.sql

-- ---------------------------------------------------------------------------
-- 1. Preconditions & constraint verification
-- ---------------------------------------------------------------------------
\echo '>>> 1. verifying constraints existence and configuration'

do $assert$
declare
  v_courses_unique boolean;
  v_fk_exists boolean;
  v_old_fk_exists boolean;
  v_fk_delete_rule text;
begin
  select exists (
    select 1 from pg_constraint
    where conrelid = 'public.courses'::regclass
      and conname = 'courses_id_user_id_key'
      and contype = 'u'
  ) into v_courses_unique;

  if not v_courses_unique then
    raise exception 'H2 ASSERTION FAILED: courses_id_user_id_key UNIQUE constraint missing on courses';
  end if;

  select exists (
    select 1 from pg_constraint
    where conrelid = 'public.tasks'::regclass
      and conname = 'tasks_course_id_user_id_fkey'
      and contype = 'f'
  ) into v_fk_exists;

  if not v_fk_exists then
    raise exception 'H2 ASSERTION FAILED: tasks_course_id_user_id_fkey composite FK missing on tasks';
  end if;

  select exists (
    select 1 from pg_constraint
    where conrelid = 'public.tasks'::regclass
      and conname = 'tasks_course_id_fkey'
  ) into v_old_fk_exists;

  if v_old_fk_exists then
    raise exception 'H2 ASSERTION FAILED: old redundant tasks_course_id_fkey constraint was not dropped';
  end if;

  select confdeltype into v_fk_delete_rule
  from pg_constraint
  where conrelid = 'public.tasks'::regclass
    and conname = 'tasks_course_id_user_id_fkey';

  if v_fk_delete_rule <> 'c' then
    raise exception 'H2 ASSERTION FAILED: composite FK ON DELETE is % (expected c = cascade)', v_fk_delete_rule;
  end if;

  raise notice 'PASS  Preconditions: courses UNIQUE(id, user_id), composite FK tasks(course_id, user_id) -> courses(id, user_id) ON DELETE CASCADE, old FK dropped';
end $assert$;

-- ---------------------------------------------------------------------------
-- 2. Verify existing data validity (Rule 9)
-- ---------------------------------------------------------------------------
\echo '>>> 2. verifying existing data validity'

do $assert$
declare
  v_invalid_count int;
begin
  select count(*) into v_invalid_count
  from public.tasks t
  left join public.courses c on t.course_id = c.id and t.user_id = c.user_id
  where c.id is null;

  if v_invalid_count > 0 then
    raise exception 'H2 ASSERTION FAILED: % existing tasks violate composite FK', v_invalid_count;
  end if;

  raise notice 'PASS  Existing data valid: 0 cross-owner tasks in existing database';
end $assert$;

-- ---------------------------------------------------------------------------
-- 3. Fixtures setup and invariant verification
-- ---------------------------------------------------------------------------
\echo '>>> 3. running invariant checks'

do $fixture$
declare
  v_user_a uuid;
  v_user_b uuid;
  v_course_a uuid;
  v_course_b uuid;
  v_task_a uuid;
  v_task_b uuid;
  v_err text;
begin
  -- User A & Course A
  insert into auth.users (id, email)
  values (gen_random_uuid(), 'h2-user-a@example.invalid')
  returning id into v_user_a;

  insert into public.courses (user_id, name)
  values (v_user_a, 'Course A')
  returning id into v_course_a;

  -- User B & Course B
  insert into auth.users (id, email)
  values (gen_random_uuid(), 'h2-user-b@example.invalid')
  returning id into v_user_b;

  insert into public.courses (user_id, name)
  values (v_user_b, 'Course B')
  returning id into v_course_b;

  -- 1. Valid insert: User A + Course A + Task A -> succeeds
  insert into public.tasks (user_id, course_id, title, deadline)
  values (v_user_a, v_course_a, 'Task A', now() + interval '1 day')
  returning id into v_task_a;

  -- 2. Valid insert: User B + Course B + Task B -> succeeds
  insert into public.tasks (user_id, course_id, title, deadline)
  values (v_user_b, v_course_b, 'Task B', now() + interval '1 day')
  returning id into v_task_b;

  raise notice 'PASS  1 & 2. Valid same-owner inserts succeeded (Task A, Task B)';

  -- 3. Invalid insert: User A + Course B -> rejected
  v_err := null;
  begin
    insert into public.tasks (user_id, course_id, title, deadline)
    values (v_user_a, v_course_b, 'Task Cross A->B', now() + interval '1 day');
  exception when foreign_key_violation then
    v_err := sqlerrm;
  end;

  if v_err is null then
    raise exception 'H2 ASSERTION FAILED: User A + Course B insert WAS ALLOWED';
  end if;
  raise notice 'PASS  3. Invalid insert User A + Course B rejected (foreign key violation)';

  -- 4. Invalid insert: User B + Course A -> rejected
  v_err := null;
  begin
    insert into public.tasks (user_id, course_id, title, deadline)
    values (v_user_b, v_course_a, 'Task Cross B->A', now() + interval '1 day');
  exception when foreign_key_violation then
    v_err := sqlerrm;
  end;

  if v_err is null then
    raise exception 'H2 ASSERTION FAILED: User B + Course A insert WAS ALLOWED';
  end if;
  raise notice 'PASS  4. Invalid insert User B + Course A rejected (foreign key violation)';

  -- 5. Invalid UPDATE: Task A course_id -> Course B -> rejected
  v_err := null;
  begin
    update public.tasks set course_id = v_course_b where id = v_task_a;
  exception when foreign_key_violation then
    v_err := sqlerrm;
  end;

  if v_err is null then
    raise exception 'H2 ASSERTION FAILED: Task A course_id -> Course B update WAS ALLOWED';
  end if;
  raise notice 'PASS  5. Invalid UPDATE Task A course_id -> Course B rejected';

  -- 6. Invalid UPDATE: Task A user_id -> User B -> rejected
  v_err := null;
  begin
    update public.tasks set user_id = v_user_b where id = v_task_a;
  exception when foreign_key_violation then
    v_err := sqlerrm;
  end;

  if v_err is null then
    raise exception 'H2 ASSERTION FAILED: Task A user_id -> User B update WAS ALLOWED';
  end if;
  raise notice 'PASS  6. Invalid UPDATE Task A user_id -> User B rejected';

  -- 7 & 8. Cascade behavior tests
  -- Cross-owner cascade safety: deleting Course B must NOT delete Task A
  delete from public.courses where id = v_course_b;

  if not exists (select 1 from public.tasks where id = v_task_a) then
    raise exception 'H2 ASSERTION FAILED: deleting Course B accidentally deleted Task A!';
  end if;
  raise notice 'PASS  8. Cross-owner cascade safety: deleting Course B did NOT delete Task A';

  -- Normal cascade: deleting Course A MUST remove Task A
  delete from public.courses where id = v_course_a;

  if exists (select 1 from public.tasks where id = v_task_a) then
    raise exception 'H2 ASSERTION FAILED: deleting Course A did not delete Task A!';
  end if;
  raise notice 'PASS  7. Normal cascade: deleting Course A removed Task A';

end $fixture$;

-- ---------------------------------------------------------------------------
-- 4. Rollback + prove no test data left behind
-- ---------------------------------------------------------------------------
\echo '>>> 4. rollback'

rollback;

\echo '>>> 5. cleanup verification'

do $assert$
declare v_left int;
begin
  select (select count(*) from auth.users where email in ('h2-user-a@example.invalid', 'h2-user-b@example.invalid'))
       + (select count(*) from public.courses where name in ('Course A', 'Course B'))
       + (select count(*) from public.tasks where title in ('Task A', 'Task B', 'Task Cross A->B', 'Task Cross B->A'))
    into v_left;

  if v_left <> 0 then
    raise exception 'H2 CLEANUP FAILED: % test rows left behind', v_left;
  end if;

  raise notice 'PASS  Cleanup: no test data left behind';
end $assert$;

\echo 'H2 REGRESSION TEST PASSED'
