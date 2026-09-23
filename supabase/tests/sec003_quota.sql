-- ============================================================================
-- SEC-003 / C4 regression test: DB quota backstop for direct PostgREST writes
-- ============================================================================
-- Proves against a real PostgreSQL database that the application quotas
-- (200 active tasks/user, 10 thresholds/task — packages/domain/src/quotas.ts)
-- cannot be bypassed through the direct PostgREST write path:
--   1. as `authenticated`, the 201st active task INSERT is rejected with
--      TASK_QUOTA_EXCEEDED and the visible count stays capped at 200
--   2. soft-deleting a task frees exactly one slot (active-only counting,
--      same definition as POST /api/v1/tasks)
--   3. the 11th threshold on one task is rejected with
--      THRESHOLD_QUOTA_EXCEEDED and the count stays at 10
--   4. cross-tenant INSERT below quota is still rejected by RLS (42501) —
--      the quota trigger does not weaken tenant isolation
--   5. `anon` (no JWT claims) cannot INSERT tasks at all
--   6. the privileged path (member of service_role: scheduler/app) still
--      writes beyond quota — the bypass is intentional and scoped
--   7. direct notification_deliveries fabrication stays denied (42501) —
--      locks the already-closed email-amplification path
--
-- Pure SQL + DO blocks only (no psql backslash commands), same pattern as
-- supabase/tests/rls_matrix.sql: runs via `psql -v ON_ERROR_STOP=1 -f` in CI
-- and via a bun sql.file() wrapper in the dev loop. Everything runs inside
-- ONE transaction that is always ROLLED BACK; fixtures use generate_series
-- (200 tasks + 800 auto thresholds per run — indexed counts, seconds).
--
-- If the quota migration is not applied, section 1 fails fast with a clear
-- message (run the pending migration, then re-run this file).
--
-- Usage:
--   psql "$DATABASE_URL" -X -v ON_ERROR_STOP=1 \
--     -f supabase/tests/sec003_quota.sql
-- ============================================================================

begin;

-- Client-simulation grant (same rationale as rls_matrix.sql: real Supabase
-- grants USAGE ON SCHEMA auth; without it trigger/auth internals fail as
-- `authenticated` with "permission denied for schema auth").
grant usage on schema auth to anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 0. Preconditions: roles, SET ROLE ability, quota triggers installed
-- ---------------------------------------------------------------------------
do $pre$
declare
  v_task_trg boolean;
  v_thr_trg boolean;
begin
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    raise exception 'SEC-003 PRECONDITION FAILED: role "authenticated" does not exist (run supabase/bootstrap.sql first)';
  end if;
  if not exists (select 1 from pg_roles where rolname = 'anon') then
    raise exception 'SEC-003 PRECONDITION FAILED: role "anon" does not exist (run supabase/bootstrap.sql first)';
  end if;
  if not pg_has_role(current_user, 'authenticated', 'member') then
    raise exception 'SEC-003 PRECONDITION FAILED: current_user % cannot SET ROLE authenticated', current_user;
  end if;
  if not pg_has_role(current_user, 'service_role', 'member') then
    raise exception 'SEC-003 PRECONDITION FAILED: current_user % is not a member of service_role; the privileged-path section cannot prove its premise', current_user;
  end if;
  if pg_has_role('authenticated', 'service_role', 'member')
     or pg_has_role('anon', 'service_role', 'member') then
    raise exception 'SEC-003 PRECONDITION FAILED: client role is unexpectedly a member of service_role; the quota guard would not apply';
  end if;

  select exists (
    select 1 from pg_trigger
    where tgrelid = 'public.tasks'::regclass and tgname = 'task_quota_before_insert'
  ) into v_task_trg;
  select exists (
    select 1 from pg_trigger
    where tgrelid = 'public.reminder_thresholds'::regclass and tgname = 'threshold_quota_before_insert'
  ) into v_thr_trg;
  if not v_task_trg or not v_thr_trg then
    raise exception 'SEC-003 PRECONDITION FAILED: quota triggers missing (task=%, thresholds=%) — apply supabase/migrations/20260921000000_sec003_task_threshold_quota.sql first', v_task_trg, v_thr_trg;
  end if;

  raise notice 'PASS  0. environment + quota triggers installed (current_user=% is service_role member, clients are not)', current_user;
end $pre$;

-- ---------------------------------------------------------------------------
-- 1. Fixtures: tenant A (quota probe) + tenant B (cross-tenant probe)
-- ---------------------------------------------------------------------------
do $fx$
declare
  v_user_a uuid;
  v_user_b uuid;
  v_course_a uuid;
  v_course_b uuid;
begin
  insert into auth.users (email) values ('sec003-a@example.invalid') returning id into v_user_a;
  insert into auth.users (email) values ('sec003-b@example.invalid') returning id into v_user_b;

  insert into public.courses (user_id, name) values (v_user_a, 'SEC-003 Course A') returning id into v_course_a;
  insert into public.courses (user_id, name) values (v_user_b, 'SEC-003 Course B') returning id into v_course_b;

  perform set_config('sec003.user_a', v_user_a::text, true);
  perform set_config('sec003.user_b', v_user_b::text, true);
  perform set_config('sec003.course_a', v_course_a::text, true);
  perform set_config('sec003.course_b', v_course_b::text, true);

  raise notice 'PASS  1. fixtures: tenants A/B with one course each';
end $fx$;

-- ---------------------------------------------------------------------------
-- 2. Direct 200-task fill as authenticated A, then 201st rejected (Test 1)
-- ---------------------------------------------------------------------------
select set_config('request.jwt.claim.sub', current_setting('sec003.user_a'), true),
       set_config('request.jwt.claim.role', 'authenticated', true),
       set_config('request.jwt.claims',
                  json_build_object('sub', current_setting('sec003.user_a'), 'role', 'authenticated')::text,
                  true);

set local role authenticated;

do $assert$
declare
  v_count int;
  v_msg text;
begin
  insert into public.tasks (user_id, course_id, title, deadline)
  select current_setting('sec003.user_a')::uuid,
         current_setting('sec003.course_a')::uuid,
         'SEC-003 Task ' || g,
         now() + interval '1 day'
  from generate_series(1, 200) g;

  select count(*) into v_count from public.tasks;
  if v_count <> 200 then
    raise exception 'SEC-003 FAILED (task quota fill): user A sees % tasks, expected 200', v_count;
  end if;
  raise notice 'PASS  2a. direct fill: 200 tasks inserted via the client path';

  v_msg := null;
  begin
    insert into public.tasks (user_id, course_id, title, deadline)
    values (current_setting('sec003.user_a')::uuid,
            current_setting('sec003.course_a')::uuid,
            'SEC-003 Task 201',
            now() + interval '1 day');
  exception when others then
    v_msg := sqlerrm;
  end;

  if v_msg is null then
    raise exception 'SEC-003 FAILED (task quota cap): 201st task WAS ALLOWED via direct write';
  end if;
  if v_msg not like 'TASK_QUOTA_EXCEEDED%' then
    raise exception 'SEC-003 FAILED (task quota cap): unexpected error (expected TASK_QUOTA_EXCEEDED): %', v_msg;
  end if;

  select count(*) into v_count from public.tasks;
  if v_count <> 200 then
    raise exception 'SEC-003 FAILED (task quota cap): count is % after rejected insert, expected 200', v_count;
  end if;

  raise notice 'PASS  2b. 201st direct INSERT rejected (TASK_QUOTA_EXCEEDED), count capped at 200';
end $assert$;

reset role;

-- ---------------------------------------------------------------------------
-- 3. Soft-delete frees exactly one slot (active-only counting, Test 2)
-- ---------------------------------------------------------------------------
select set_config('request.jwt.claim.sub', current_setting('sec003.user_a'), true),
       set_config('request.jwt.claim.role', 'authenticated', true),
       set_config('request.jwt.claims',
                  json_build_object('sub', current_setting('sec003.user_a'), 'role', 'authenticated')::text,
                  true);

set local role authenticated;

do $assert$
declare
  v_count int;
  v_victim uuid;
begin
  -- Soft-delete via UPDATE deleted_at (the app path; hard DELETE has no policy).
  update public.tasks set deleted_at = clock_timestamp()
  where title = 'SEC-003 Task 1'
  returning id into v_victim;
  if v_victim is null then
    raise exception 'SEC-003 FAILED (slot free): could not soft-delete own task';
  end if;

  insert into public.tasks (user_id, course_id, title, deadline)
  values (current_setting('sec003.user_a')::uuid,
          current_setting('sec003.course_a')::uuid,
          'SEC-003 Task replacement',
          now() + interval '1 day');

  select count(*) into v_count from public.tasks where deleted_at is null;
  if v_count <> 200 then
    raise exception 'SEC-003 FAILED (slot free): active count is %, expected 200 after replace', v_count;
  end if;

  raise notice 'PASS  3. soft-delete frees one slot; replacement insert allowed, active count back at 200';
end $assert$;

reset role;

-- ---------------------------------------------------------------------------
-- 4. Threshold quota: 10 per task, 11th rejected (Test 3)
-- ---------------------------------------------------------------------------
select set_config('request.jwt.claim.sub', current_setting('sec003.user_a'), true),
       set_config('request.jwt.claim.role', 'authenticated', true),
       set_config('request.jwt.claims',
                  json_build_object('sub', current_setting('sec003.user_a'), 'role', 'authenticated')::text,
                  true);

set local role authenticated;

do $assert$
declare
  v_task uuid;
  v_count int;
  v_rows int;
  v_msg text;
begin
  -- Task 2 carries the 4 auto defaults; add 6 custom (100..105) to reach 10.
  select id into v_task from public.tasks where title = 'SEC-003 Task 2';
  if v_task is null then
    raise exception 'SEC-003 FAILED (threshold quota): fixture task missing';
  end if;

  insert into public.reminder_thresholds (task_id, days_before, is_default)
  select v_task, 100 + g, false from generate_series(0, 5) g;

  select count(*) into v_count from public.reminder_thresholds where task_id = v_task;
  if v_count <> 10 then
    raise exception 'SEC-003 FAILED (threshold quota fill): task has % thresholds, expected 10', v_count;
  end if;

  v_msg := null;
  begin
    insert into public.reminder_thresholds (task_id, days_before, is_default)
    values (v_task, 106, false);
  exception when others then
    v_msg := sqlerrm;
  end;
  if v_msg is null then
    raise exception 'SEC-003 FAILED (threshold quota cap): 11th threshold WAS ALLOWED via direct write';
  end if;
  if v_msg not like 'THRESHOLD_QUOTA_EXCEEDED%' then
    raise exception 'SEC-003 FAILED (threshold quota cap): unexpected error (expected THRESHOLD_QUOTA_EXCEEDED): %', v_msg;
  end if;

  select count(*) into v_count from public.reminder_thresholds where task_id = v_task;
  if v_count <> 10 then
    raise exception 'SEC-003 FAILED (threshold quota cap): count is % after rejected insert, expected 10', v_count;
  end if;

  -- RF-09: archiving frees a quota slot (the trigger counts live rows only).
  update public.reminder_thresholds set deleted_at = clock_timestamp()
  where task_id = v_task and days_before = 105;
  get diagnostics v_rows = row_count;
  if v_rows <> 1 then
    raise exception 'SEC-003 FAILED (archive frees slot): archived % rows, expected 1', v_rows;
  end if;

  insert into public.reminder_thresholds (task_id, days_before, is_default)
  values (v_task, 107, false);

  select count(*) into v_count from public.reminder_thresholds
  where task_id = v_task and deleted_at is null;
  if v_count <> 10 then
    raise exception 'SEC-003 FAILED (archive frees slot): active count is %, expected 10 after replace', v_count;
  end if;

  raise notice 'PASS  4. 11th direct threshold INSERT rejected (THRESHOLD_QUOTA_EXCEEDED), archive frees a slot';
end $assert$;

reset role;

-- ---------------------------------------------------------------------------
-- 5. Cross-tenant INSERT below quota still hits RLS first (Test 4)
-- ---------------------------------------------------------------------------
select set_config('request.jwt.claim.sub', current_setting('sec003.user_a'), true),
       set_config('request.jwt.claim.role', 'authenticated', true),
       set_config('request.jwt.claims',
                  json_build_object('sub', current_setting('sec003.user_a'), 'role', 'authenticated')::text,
                  true);

set local role authenticated;

do $assert$
declare
  v_state text;
begin
  -- Tenant B owns 0 tasks: the quota trigger passes, so a denial here
  -- proves RLS (not the quota) still guards tenant isolation.
  v_state := null;
  begin
    insert into public.tasks (user_id, course_id, title, deadline)
    values (current_setting('sec003.user_b')::uuid,
            current_setting('sec003.course_b')::uuid,
            'SEC-003 Smuggle',
            now() + interval '1 day');
  exception when others then
    v_state := sqlstate;
  end;
  if v_state is null then
    raise exception 'SEC-003 FAILED (cross-tenant): user A inserting as user B WAS ALLOWED';
  end if;
  if v_state <> '42501' then
    raise exception 'SEC-003 FAILED (cross-tenant): sqlstate=%, expected 42501 (RLS, not quota)', v_state;
  end if;

  raise notice 'PASS  5. cross-tenant direct INSERT still rejected by RLS (42501), quota trigger does not weaken isolation';
end $assert$;

reset role;

-- ---------------------------------------------------------------------------
-- 6. anon (no JWT claims) cannot INSERT tasks at all (Test 5)
-- ---------------------------------------------------------------------------
-- NOTE: claims are transaction-local and this whole file is one transaction,
-- so §2's claims would otherwise still be set here — and RLS predicates only
-- read the claims, not the role, meaning a claim-stale "anon" would inherit
-- user A's identity (verified during development: the quota trigger then
-- sees 200 rows). A genuine claimless client sends no claims, so clear them
-- to simulate true anon: auth.uid() becomes NULL and every USING fails.
select set_config('request.jwt.claim.sub', '', true),
       set_config('request.jwt.claim.role', '', true),
       set_config('request.jwt.claims', '{}', true);

set local role anon;

do $assert$
declare
  v_state text;
begin
  v_state := null;
  begin
    insert into public.tasks (user_id, course_id, title, deadline)
    values (current_setting('sec003.user_a')::uuid,
            current_setting('sec003.course_a')::uuid,
            'SEC-003 Anon Smuggle',
            now() + interval '1 day');
  exception when others then
    v_state := sqlstate;
  end;
  if v_state is null then
    raise exception 'SEC-003 FAILED (anon): anonymous INSERT WAS ALLOWED';
  end if;
  if v_state <> '42501' then
    raise exception 'SEC-003 FAILED (anon): sqlstate=%, expected 42501', v_state;
  end if;

  raise notice 'PASS  6. anon direct INSERT denied (42501)';
end $assert$;

reset role;

-- ---------------------------------------------------------------------------
-- 7. Privileged path still writes beyond quota: bypass intentional + scoped
-- ---------------------------------------------------------------------------
do $assert$
declare
  v_count int;
begin
  -- current_user is the session owner (member of service_role per §0), the
  -- same privilege class as the scheduler/app DATABASE_URL role: the quota
  -- trigger must let it through so legitimate writes never break.
  insert into public.tasks (user_id, course_id, title, deadline)
  values (current_setting('sec003.user_a')::uuid,
          current_setting('sec003.course_a')::uuid,
          'SEC-003 Privileged overflow',
          now() + interval '1 day');

  select count(*) into v_count
  from public.tasks
  where user_id = current_setting('sec003.user_a')::uuid
    and deleted_at is null;
  if v_count <> 201 then
    raise exception 'SEC-003 FAILED (privileged bypass): active count is %, expected 201 (bypass broken?)', v_count;
  end if;

  raise notice 'PASS  7. privileged (service_role member) path writes beyond quota — bypass intentional and scoped';
end $assert$;

-- ---------------------------------------------------------------------------
-- 8. Direct notification_deliveries fabrication stays denied (lock Test 7)
-- ---------------------------------------------------------------------------
select set_config('request.jwt.claim.sub', current_setting('sec003.user_a'), true),
       set_config('request.jwt.claim.role', 'authenticated', true),
       set_config('request.jwt.claims',
                  json_build_object('sub', current_setting('sec003.user_a'), 'role', 'authenticated')::text,
                  true);

set local role authenticated;

do $assert$
declare
  v_task uuid;
  v_thr uuid;
  v_state text;
begin
  select id into v_task from public.tasks where title = 'SEC-003 Task 2';
  select id into v_thr from public.reminder_thresholds
  where task_id = v_task order by days_before limit 1;

  v_state := null;
  begin
    insert into public.notification_deliveries (task_id, threshold_id, days_before, channel)
    values (v_task, v_thr, 7, 'email');
  exception when others then
    v_state := sqlstate;
  end;
  if v_state <> '42501' then
    raise exception 'SEC-003 FAILED (deliveries lock): sqlstate=%, expected 42501 (no INSERT policy)', coalesce(v_state, 'ALLOWED');
  end if;

  raise notice 'PASS  8. direct deliveries fabrication still denied (42501) — email-amplification path stays closed';
end $assert$;

reset role;

-- ---------------------------------------------------------------------------
-- 9. Roll back everything, then prove no fixture data left behind
-- ---------------------------------------------------------------------------
rollback;

do $assert$
declare
  v_left int;
begin
  select (
    (select count(*) from auth.users where email in ('sec003-a@example.invalid', 'sec003-b@example.invalid'))
    + (select count(*) from public.courses where name like 'SEC-003%')
    + (select count(*) from public.tasks where title like 'SEC-003%')
  ) into v_left;

  if v_left <> 0 then
    raise exception 'SEC-003 CLEANUP FAILED: % fixture rows left behind', v_left;
  end if;

  raise notice 'PASS  9. cleanup: no fixture data left behind';
end $assert$;
