-- ============================================================================
-- I-137 regression test: idempotency dedupe keys on business rows
-- ============================================================================
-- Proves against a real PostgreSQL database that:
--   1. The migration adds nullable idempotency_key columns to courses,
--      tasks, reminder_thresholds and attachments
--   2. The four partial unique dedupe indexes exist
--   3. A duplicate (owner, idempotency_key) insert is rejected (23505) on
--      each table, so a stale-reclaim re-execution conflicts instead of
--      duplicating the row
--   4. Rows with NULL keys never conflict with each other
--   5. The migration is idempotent (applied twice in transaction)
--   6. The test leaves NO data behind (all changes rolled back)
--
-- Usage:
--   export $(grep -v '^#' .env.local | xargs)
--   psql "$DATABASE_URL" -X -v ON_ERROR_STOP=1 \
--     -f supabase/tests/i137_idempotency_dedupe_test.sql
-- ============================================================================

\set ON_ERROR_STOP on

-- ---------------------------------------------------------------------------
-- 0. Apply the migration under test, twice (proves idempotency), in-transaction
-- ---------------------------------------------------------------------------
\echo '>>> 0. applying migration under test twice (idempotency)'

begin;

\ir ../migrations/20261007000000_idempotency_dedupe_keys.sql
\ir ../migrations/20261007000000_idempotency_dedupe_keys.sql

-- ---------------------------------------------------------------------------
-- 1. Columns and partial unique indexes exist
-- ---------------------------------------------------------------------------
\echo '>>> 1. verifying columns and partial unique indexes'

do $assert$
declare
  v_missing text;
begin
  select string_agg(t.tablename || '.' || t.columnname, ', ')
    into v_missing
    from (values
      ('courses', 'idempotency_key'),
      ('tasks', 'idempotency_key'),
      ('reminder_thresholds', 'idempotency_key'),
      ('attachments', 'idempotency_key')
    ) as t(tablename, columnname)
    where not exists (
      select 1 from information_schema.columns c
      where c.table_schema = 'public'
        and c.table_name = t.tablename
        and c.column_name = t.columnname
        and c.is_nullable = 'YES'
        and c.data_type = 'text'
    );
  if v_missing is not null then
    raise exception 'I137 ASSERTION FAILED: missing nullable text columns: %', v_missing;
  end if;

  select string_agg(t.indexname, ', ')
    into v_missing
    from (values
      ('courses_user_idempotency_key'),
      ('tasks_user_idempotency_key'),
      ('reminder_thresholds_task_idempotency_key'),
      ('attachments_task_idempotency_key')
    ) as t(indexname)
    where not exists (
      select 1 from pg_index i
      join pg_class c on c.oid = i.indexrelid
      where c.relname = t.indexname
        and i.indisunique
        and i.indpred is not null
    );
  if v_missing is not null then
    raise exception 'I137 ASSERTION FAILED: missing partial unique indexes: %', v_missing;
  end if;
end
$assert$;

-- ---------------------------------------------------------------------------
-- 2. Duplicate keyed inserts conflict; NULL keys never conflict
-- ---------------------------------------------------------------------------
\echo '>>> 2. duplicate keyed inserts conflict, NULL keys do not'

do $assert$
declare
  v_user uuid;
  v_course uuid := gen_random_uuid();
  v_task uuid := gen_random_uuid();
  v_dup_rejected boolean;
begin
  -- profiles.id references auth.users: seed the auth user first (like
  -- sec003_quota.sql). Everything rolls back at the end, so no residue.
  insert into auth.users (email)
    values ('i137@example.invalid')
    returning id into v_user;
  -- The handle_new_user trigger usually creates the profile; insert only
  -- as a fallback so this works with or without the trigger.
  insert into public.profiles (id, email)
    values (v_user, 'i137@example.invalid')
    on conflict do nothing;
  insert into public.courses (id, user_id, name, idempotency_key)
    values (v_course, v_user, 'I137', 'key-course-1');

  -- courses: same (user_id, key) rejected
  begin
    insert into public.courses (user_id, name, idempotency_key)
      values (v_user, 'I137 dup', 'key-course-1');
    v_dup_rejected := false;
  exception when unique_violation then
    v_dup_rejected := true;
  end;
  if not v_dup_rejected then
    raise exception 'I137 ASSERTION FAILED: duplicate courses idempotency_key was not rejected';
  end if;

  -- courses: NULL keys never conflict
  insert into public.courses (user_id, name) values (v_user, 'I137 null-a');
  insert into public.courses (user_id, name) values (v_user, 'I137 null-b');

  -- tasks: same (user_id, key) rejected
  insert into public.tasks (id, user_id, course_id, title, deadline, status, idempotency_key)
    values (v_task, v_user, v_course, 'I137', now() + interval '1 day', 'todo', 'key-task-1');
  begin
    insert into public.tasks (user_id, course_id, title, deadline, status, idempotency_key)
      values (v_user, v_course, 'I137 dup', now() + interval '1 day', 'todo', 'key-task-1');
    v_dup_rejected := false;
  exception when unique_violation then
    v_dup_rejected := true;
  end;
  if not v_dup_rejected then
    raise exception 'I137 ASSERTION FAILED: duplicate tasks idempotency_key was not rejected';
  end if;

  -- reminder_thresholds: same (task_id, key) rejected
  insert into public.reminder_thresholds (task_id, days_before, idempotency_key)
    values (v_task, 3, 'key-threshold-1');
  begin
    insert into public.reminder_thresholds (task_id, days_before, idempotency_key)
      values (v_task, 5, 'key-threshold-1');
    v_dup_rejected := false;
  exception when unique_violation then
    v_dup_rejected := true;
  end;
  if not v_dup_rejected then
    raise exception 'I137 ASSERTION FAILED: duplicate reminder_thresholds idempotency_key was not rejected';
  end if;

  -- attachments: same (task_id, key) rejected
  insert into public.attachments (task_id, type, url, idempotency_key)
    values (v_task, 'link', 'https://example.com/i137', 'key-attachment-1');
  begin
    insert into public.attachments (task_id, type, url, idempotency_key)
      values (v_task, 'link', 'https://example.com/i137-dup', 'key-attachment-1');
    v_dup_rejected := false;
  exception when unique_violation then
    v_dup_rejected := true;
  end;
  if not v_dup_rejected then
    raise exception 'I137 ASSERTION FAILED: duplicate attachments idempotency_key was not rejected';
  end if;

  -- NULL keys never conflict on any table
  insert into public.tasks (user_id, course_id, title, deadline, status)
    values (v_user, v_course, 'I137 null-a', now() + interval '1 day', 'todo');
  insert into public.tasks (user_id, course_id, title, deadline, status)
    values (v_user, v_course, 'I137 null-b', now() + interval '1 day', 'todo');
end
$assert$;

-- ---------------------------------------------------------------------------
-- 3. Roll back everything (no residue)
-- ---------------------------------------------------------------------------
\echo '>>> 3. rolling back (no test residue)'

rollback;
\echo 'I137 OK'
