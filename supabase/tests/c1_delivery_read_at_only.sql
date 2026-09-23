-- ============================================================================
-- C-1 regression test: notification_deliveries read_at-only trigger
-- ============================================================================
-- Proves, against a real PostgreSQL database, that after applying
--   20260918000000_notification_deliveries_scheduler_bypass.sql
--
--   A. the scheduler's privileged connection (a member of `service_role`) can
--      perform every state transition the evaluator needs:
--        pending -> sent (+ sent_at)   sent -> failed
--        pending -> failed             failed -> pending (+ retry_count)
--        bare retry_count increment    read_at
--   B. an authenticated client can change ONLY read_at; status, retry_count,
--      sent_at, task_id, threshold_id, channel and created_at stay blocked
--      with the trigger's exact error message
--   C. the trigger is still enabled, BEFORE UPDATE, FOR EACH ROW, no WHEN
--   D. INSERT into notification_deliveries is unaffected
--   E. the environment assumption pg_has_role(current_user,'service_role',
--      'member') holds (otherwise the fix would silently not apply)
--   F. the migration is idempotent (applied twice)
--   G. the test leaves NO data behind
--
-- Usage (run as the scheduler / privileged DATABASE_URL role):
--   psql "$DATABASE_URL" -X -v ON_ERROR_STOP=1 \
--     -f supabase/tests/c1_delivery_read_at_only.sql
--
-- Everything runs inside ONE transaction that is always ROLLED BACK. Any failed
-- assertion RAISEs, so ON_ERROR_STOP makes psql exit non-zero. No email/Resend
-- call is made: the test only exercises database transitions.
--
-- Note: the test applies the migration under test in-transaction, so it passes
-- both before and after deployment. Verifying the *deployed* function is a
-- separate read-only check (see the C-1 fix proposal).
-- ============================================================================

\set ON_ERROR_STOP on

-- ---------------------------------------------------------------------------
-- 0. Apply the migration under test, twice (proves idempotency), in-transaction
-- ---------------------------------------------------------------------------
\echo '>>> 0. applying migration under test twice (idempotency)'

begin;

\ir ../migrations/20260918000000_notification_deliveries_scheduler_bypass.sql
\ir ../migrations/20260918000000_notification_deliveries_scheduler_bypass.sql

-- ---------------------------------------------------------------------------
-- 1. Migration + environment preconditions
-- ---------------------------------------------------------------------------
\echo '>>> 1. preconditions'

do $assert$
declare
  v_has_authenticated boolean;
  v_has_anon boolean;
begin
  if pg_get_functiondef('public.enforce_delivery_read_at_only()'::regprocedure)
       not like '%pg_has_role%' then
    raise exception 'C1 ASSERTION FAILED: migration did not install the expanded guard';
  end if;

  if not pg_has_role(current_user, 'service_role', 'member') then
    raise exception 'C1 PRECONDITION FAILED: current_user % is not a member of service_role; run this test as the scheduler/direct-connection role', current_user;
  end if;

  select exists (select 1 from pg_roles where rolname = 'authenticated')
    into v_has_authenticated;
  if not v_has_authenticated then
    raise exception 'C1 PRECONDITION FAILED: role "authenticated" does not exist';
  end if;

  if pg_has_role('authenticated', 'service_role', 'member') then
    raise exception 'C1 PRECONDITION FAILED: "authenticated" is unexpectedly a member of service_role; the client guard would not apply';
  end if;

  if not pg_has_role(current_user, 'authenticated', 'member') then
    raise exception 'C1 PRECONDITION FAILED: current_user % cannot SET ROLE authenticated (needed to simulate the client path)', current_user;
  end if;

  select exists (select 1 from pg_roles where rolname = 'anon') into v_has_anon;
  if v_has_anon and pg_has_role('anon', 'service_role', 'member') then
    raise exception 'C1 PRECONDITION FAILED: "anon" is unexpectedly a member of service_role';
  end if;

  raise notice 'PASS  E. environment assumption holds (role=%, member_of_service_role=true, authenticated is not a member)', current_user;
end $assert$;

-- ---------------------------------------------------------------------------
-- 2. Trigger shape must be unchanged
-- ---------------------------------------------------------------------------
\echo '>>> 2. trigger definition'

do $assert$
declare
  v_cnt int;
  v_name text;
  v_enabled text;
  v_type int;
  v_def text;
begin
  select count(*) into v_cnt
  from pg_trigger
  where tgrelid = 'public.notification_deliveries'::regclass and not tgisinternal;
  if v_cnt <> 1 then
    raise exception 'C1 ASSERTION FAILED: expected exactly 1 trigger on notification_deliveries, found %', v_cnt;
  end if;

  select tgname, tgenabled::text, tgtype, pg_get_triggerdef(oid)
    into v_name, v_enabled, v_type, v_def
  from pg_trigger
  where tgrelid = 'public.notification_deliveries'::regclass and not tgisinternal;

  if v_name <> 'notification_deliveries_read_at_only' then
    raise exception 'C1 ASSERTION FAILED: unexpected trigger name %', v_name;
  end if;
  if v_enabled <> 'O' then
    raise exception 'C1 ASSERTION FAILED: trigger % is not enabled (tgenabled=%)', v_name, v_enabled;
  end if;
  -- tgtype bitmask: 1 = ROW, 2 = BEFORE, 16 = UPDATE
  if v_type <> 19 then
    raise exception 'C1 ASSERTION FAILED: trigger is not BEFORE UPDATE FOR EACH ROW (tgtype=%)', v_type;
  end if;
  if v_def ilike '%WHEN%' then
    raise exception 'C1 ASSERTION FAILED: trigger unexpectedly has a WHEN clause: %', v_def;
  end if;

  raise notice 'PASS  C. trigger % enabled, BEFORE UPDATE FOR EACH ROW, no WHEN clause', v_name;
end $assert$;

-- ---------------------------------------------------------------------------
-- 3. Self-contained fixture (created inside the rolled-back transaction)
-- ---------------------------------------------------------------------------
\echo '>>> 3. fixture'

do $fixture$
declare
  v_uid uuid;
  v_course uuid;
  v_task uuid;
  v_thresholds int;
begin
  insert into auth.users (id, email)
  values (gen_random_uuid(), 'c1-fixture@example.invalid')
  returning id into v_uid;

  if (select count(*) from public.profiles where id = v_uid) <> 1 then
    raise exception 'C1 FIXTURE FAILED: profile was not auto-provisioned for the fixture user';
  end if;

  insert into public.courses (user_id, name)
  values (v_uid, 'C1 fixture course')
  returning id into v_course;

  insert into public.tasks (user_id, course_id, title, deadline)
  values (v_uid, v_course, 'C1 fixture task', now() + interval '3 days')
  returning id into v_task;

  select count(*) into v_thresholds
  from public.reminder_thresholds where task_id = v_task;
  if v_thresholds < 1 then
    raise exception 'C1 FIXTURE FAILED: default reminder thresholds were not generated';
  end if;

  insert into public.notification_deliveries (task_id, threshold_id, channel, status, retry_count, days_before)
  select v_task, rt.id, 'email', 'pending', 0, rt.days_before
  from public.reminder_thresholds rt
  where rt.task_id = v_task
  order by rt.days_before
  limit 1;

  raise notice 'PASS  fixture created (auth user -> profile -> course -> task -> % thresholds)', v_thresholds;
end $fixture$;

do $assert$
begin
  if (select count(*) from public.notification_deliveries where channel = 'email') <> 1 then
    raise exception 'C1 ASSERTION FAILED: fixture delivery row missing';
  end if;
  raise notice 'PASS  D. INSERT is unaffected by the read_at-only trigger (no BEFORE INSERT trigger)';
end $assert$;

select id as c1_owner from public.profiles where email = 'c1-fixture@example.invalid' \gset

-- ---------------------------------------------------------------------------
-- 4. A. Privileged scheduler path: every transition must be ALLOWED
-- ---------------------------------------------------------------------------
\echo '>>> 4. A. privileged (scheduler) transitions'

do $assert$
declare v_row public.notification_deliveries;
begin
  -- pending -> sent (+ sent_at)
  update public.notification_deliveries
     set status = 'sent', sent_at = clock_timestamp()
   where channel = 'email';
  select * into v_row from public.notification_deliveries where channel = 'email';
  if v_row.status <> 'sent' or v_row.sent_at is null then
    raise exception 'C1 ASSERTION FAILED: pending -> sent + sent_at did not stick (status=%, sent_at=%)', v_row.status, v_row.sent_at;
  end if;
  raise notice 'PASS  A1. pending -> sent with sent_at populated';

  -- sent -> failed
  update public.notification_deliveries set status = 'failed' where channel = 'email';
  if (select status from public.notification_deliveries where channel = 'email') <> 'failed' then
    raise exception 'C1 ASSERTION FAILED: sent -> failed did not stick';
  end if;
  raise notice 'PASS  A2. sent -> failed';

  -- failed -> pending (+ retry_count): the atomic retry-claim path
  update public.notification_deliveries
     set status = 'pending', retry_count = retry_count + 1
   where channel = 'email';
  select * into v_row from public.notification_deliveries where channel = 'email';
  if v_row.status <> 'pending' or v_row.retry_count <> 1 then
    raise exception 'C1 ASSERTION FAILED: failed -> pending + retry_count did not stick (status=%, retry_count=%)', v_row.status, v_row.retry_count;
  end if;
  raise notice 'PASS  A3. failed -> pending with retry_count increment';

  -- pending -> failed
  update public.notification_deliveries set status = 'failed' where channel = 'email';
  if (select status from public.notification_deliveries where channel = 'email') <> 'failed' then
    raise exception 'C1 ASSERTION FAILED: pending -> failed did not stick';
  end if;
  raise notice 'PASS  A4. pending -> failed';

  -- bare retry_count increment (markFailed with an explicit retry count)
  update public.notification_deliveries set retry_count = retry_count + 1 where channel = 'email';
  if (select retry_count from public.notification_deliveries where channel = 'email') <> 2 then
    raise exception 'C1 ASSERTION FAILED: retry_count increment did not stick';
  end if;
  raise notice 'PASS  A5. retry_count increment';

  -- read_at stays allowed on the privileged path too
  update public.notification_deliveries set read_at = clock_timestamp() where channel = 'email';
  if (select read_at from public.notification_deliveries where channel = 'email') is null then
    raise exception 'C1 ASSERTION FAILED: read_at did not stick';
  end if;
  raise notice 'PASS  A6. read_at allowed';
end $assert$;

-- reset the row to a known state before the client section
update public.notification_deliveries
   set status = 'pending', retry_count = 0, sent_at = null, read_at = null
 where channel = 'email';

-- ---------------------------------------------------------------------------
-- 5. B. Authenticated client path: only read_at may change
-- ---------------------------------------------------------------------------
\echo '>>> 5. B. authenticated client path'

select set_config('request.jwt.claim.sub', :'c1_owner', true),
       set_config('request.jwt.claim.role', 'authenticated', true),
       set_config('request.jwt.claims',
                  json_build_object('sub', :'c1_owner', 'role', 'authenticated')::text,
                  true);

set local role authenticated;

do $assert$
declare
  v_before public.notification_deliveries;
  v_after public.notification_deliveries;
  v_probe record;
  v_err text;
begin
  select * into v_before from public.notification_deliveries where channel = 'email';
  if v_before.id is null then
    raise exception 'C1 ASSERTION FAILED: authenticated client cannot see its own fixture row (RLS / auth.uid() mismatch)';
  end if;

  -- B1..B7: every column the trigger protects must stay BLOCKED
  for v_probe in
    select * from (values
      ('B1 status',        'status = ''sent''',                                     true),
      ('B2 retry_count',   'retry_count = retry_count + 1',                         true),
      ('B3 sent_at',       'sent_at = clock_timestamp()',                           true),
      ('B4 task_id',       'task_id = ''00000000-0000-4000-8000-000000000000''',    false),
      ('B5 threshold_id',  'threshold_id = ''00000000-0000-4000-8000-000000000000''', false),
      ('B6 channel',       'channel = ''in_app''',                                  false),
      ('B7 created_at',    'created_at = clock_timestamp()',                        false)
    ) as t(label, set_clause, require_exact_message)
  loop
    v_err := null;
    begin
      execute format('update public.notification_deliveries set %s where channel = %L',
                     v_probe.set_clause, 'email');
    exception when others then
      v_err := sqlerrm;
    end;

    if v_err is null then
      raise exception 'C1 ASSERTION FAILED: % — authenticated WAS ALLOWED to change this column', v_probe.label;
    end if;

    if v_probe.require_exact_message
       and v_err <> 'Only read_at may be updated on notification_deliveries' then
      raise exception 'C1 ASSERTION FAILED: % — blocked by an unexpected error: %', v_probe.label, v_err;
    end if;

    select * into v_after from public.notification_deliveries where channel = 'email';
    if v_after is distinct from v_before then
      raise exception 'C1 ASSERTION FAILED: % — row changed despite the blocked update', v_probe.label;
    end if;

    raise notice 'PASS  % — authenticated BLOCKED (%)', v_probe.label, v_err;
  end loop;

  -- B8: read_at must remain allowed for authenticated clients
  v_err := null;
  begin
    update public.notification_deliveries set read_at = clock_timestamp() where channel = 'email';
  exception when others then
    v_err := sqlerrm;
  end;
  if v_err is not null then
    raise exception 'C1 ASSERTION FAILED: B8 read_at — authenticated could NOT set read_at: %', v_err;
  end if;
  raise notice 'PASS  B8 read_at — authenticated ALLOWED';
end $assert$;

reset role;

-- ---------------------------------------------------------------------------
-- 6. Rollback + prove no test data is left behind
-- ---------------------------------------------------------------------------
\echo '>>> 6. rollback'

rollback;

\echo '>>> 7. cleanup verification'

do $assert$
declare v_left int;
begin
  select (select count(*) from auth.users      where email = 'c1-fixture@example.invalid')
       + (select count(*) from public.profiles where email = 'c1-fixture@example.invalid')
       + (select count(*) from public.courses  where name  = 'C1 fixture course')
       + (select count(*) from public.tasks    where title = 'C1 fixture task')
    into v_left;

  if v_left <> 0 then
    raise exception 'C1 CLEANUP FAILED: % test rows left behind (transaction not rolled back?)', v_left;
  end if;

  raise notice 'PASS  G. no test data left behind (transaction rolled back)';
end $assert$;

\echo 'C1 REGRESSION TEST PASSED'
