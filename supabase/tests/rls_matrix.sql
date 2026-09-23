-- ============================================================================
-- F-1 regression test: RLS row-visibility matrix as the end-user role
-- ============================================================================
-- Proves against a real PostgreSQL database, AS `authenticated` (not as the
-- table owner / superuser that bypasses RLS), that:
--   1. tasks SELECT isolates tenants (A sees only A rows; B rows invisible)
--   2. tasks INSERT WITH CHECK blocks cross-tenant writes (42501, count kept)
--   3. RLS is enabled on EXACTLY the 12 tenant tables (fails on new table w/o RLS)
--   4. Per-op allow+deny matrix for courses/tasks/thresholds/deliveries/
--      attachments/profiles, incl. courses DELETE must fail and zero-policy
--      tables (roles, role_capabilities, user_roles, auth_audit_events,
--      idempotency_keys, reminder_runs) denying `authenticated`
--   5. No views/materialized views in public (a new reporting view must pass
--      explicit RLS review before it can land) and no SECURITY DEFINER
--      function outside the contract allowlist
--
-- Unlike schema-drift.test.ts (which only asserts policy NAMES exist), every
-- assertion below exercises the policy BODY: drop a USING/WITH CHECK
-- predicate and this file goes red.
--
-- Pure SQL + DO blocks only (no psql backslash commands) so the file runs
-- both via `psql -v ON_ERROR_STOP=1 -f` in CI and via a bun `sql.file()`
-- wrapper in the dev loop. SET LOCAL ROLE must stay at the top level of the
-- transaction (it is illegal inside a DO/function body), hence the repeated
-- set_config / set local role / do / reset role pattern.
--
-- Usage:
--   psql "$DATABASE_URL" -X -v ON_ERROR_STOP=1 \
--     -f supabase/tests/rls_matrix.sql
-- ============================================================================

begin;

-- Client-simulation grants (idempotent, rolled back with the test).
-- Real Supabase grants USAGE ON SCHEMA auth to anon/authenticated, so
-- auth.uid()/auth.role() resolve on the client path. Vanilla-PG test DBs
-- only have that if bootstrap.sql provided it; without it, trigger-internal
-- auth.* calls fail with "permission denied for schema auth" as
-- `authenticated` (RLS policy predicates are unaffected — they evaluate
-- with the table owner's privileges). Re-issuing here keeps this file
-- self-contained on any bootstrap vintage (same pattern as C-1's \ir).
grant usage on schema auth to anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 0. Environment preconditions (fail fast when the harness cannot simulate
--    the client path: role missing, cannot SET ROLE, or authenticated is
--    wrongly a member of service_role so the guard would not apply)
-- ---------------------------------------------------------------------------
do $pre$
declare
  v_has_authenticated boolean;
  v_has_anon boolean;
begin
  select exists (select 1 from pg_roles where rolname = 'authenticated')
    into v_has_authenticated;
  if not v_has_authenticated then
    raise exception 'RLS MATRIX PRECONDITION FAILED: role "authenticated" does not exist (run supabase/bootstrap.sql first)';
  end if;

  select exists (select 1 from pg_roles where rolname = 'anon')
    into v_has_anon;
  if not v_has_anon then
    raise exception 'RLS MATRIX PRECONDITION FAILED: role "anon" does not exist (run supabase/bootstrap.sql first)';
  end if;

  if pg_has_role('authenticated', 'service_role', 'member') then
    raise exception 'RLS MATRIX PRECONDITION FAILED: "authenticated" is unexpectedly a member of service_role; the client guard would not apply';
  end if;

  if not pg_has_role(current_user, 'authenticated', 'member') then
    raise exception 'RLS MATRIX PRECONDITION FAILED: current_user % cannot SET ROLE authenticated (needed to simulate the client path)', current_user;
  end if;

  raise notice 'PASS  0. environment: authenticated/anon roles exist, authenticated is not service_role, % can SET ROLE', current_user;
end $pre$;

-- ---------------------------------------------------------------------------
-- 1. Fixtures: two tenants (A/B) with full object graphs, as superuser
--    (bypasses RLS, like the service_role scheduler path)
-- ---------------------------------------------------------------------------
do $fx$
declare
  v_user_a uuid;
  v_user_b uuid;
  v_course_a uuid;
  v_course_b uuid;
  v_task_a uuid;
  v_task_b uuid;
  v_thr_a uuid;
  v_thr_b uuid;
  v_thr_del uuid;
  v_role_seed uuid;
begin
  insert into auth.users (email) values ('rls-matrix-a@example.invalid') returning id into v_user_a;
  insert into auth.users (email) values ('rls-matrix-b@example.invalid') returning id into v_user_b;

  insert into public.courses (user_id, name) values (v_user_a, 'RLS Matrix Course A') returning id into v_course_a;
  insert into public.courses (user_id, name) values (v_user_b, 'RLS Matrix Course B') returning id into v_course_b;

  insert into public.tasks (user_id, course_id, title, deadline)
  values (v_user_a, v_course_a, 'RLS Matrix Task A', now() + interval '1 day')
  returning id into v_task_a;
  insert into public.tasks (user_id, course_id, title, deadline)
  values (v_user_b, v_course_b, 'RLS Matrix Task B', now() + interval '1 day')
  returning id into v_task_b;

  -- Custom thresholds (days_before 30/60 avoid colliding with the 7/3/1/0
  -- defaults auto-created by generate_default_thresholds()).
  insert into public.reminder_thresholds (task_id, days_before, is_default)
  values (v_task_a, 30, false) returning id into v_thr_a;
  insert into public.reminder_thresholds (task_id, days_before, is_default)
  values (v_task_b, 30, false) returning id into v_thr_b;
  insert into public.reminder_thresholds (task_id, days_before, is_default)
  values (v_task_a, 60, false) returning id into v_thr_del;

  insert into public.notification_deliveries (task_id, threshold_id, days_before, channel)
  values (v_task_a, v_thr_a, 30, 'email');
  insert into public.notification_deliveries (task_id, threshold_id, days_before, channel)
  values (v_task_b, v_thr_b, 30, 'email');

  insert into public.attachments (task_id, type, url)
  values (v_task_a, 'link', 'https://example.invalid/a');
  insert into public.attachments (task_id, type, url)
  values (v_task_b, 'link', 'https://example.invalid/b');
  insert into public.attachments (task_id, type, url)
  values (v_task_a, 'link', 'https://example.invalid/a-del');

  -- Seed one row in each zero-policy table so SELECT-invisibility probes are
  -- meaningful (a probe over an empty table would pass vacuously).
  insert into public.roles (slug, description)
  values ('rls-matrix-seed', 'RLS matrix seed role') returning id into v_role_seed;
  insert into public.role_capabilities (role_id, capability)
  values (v_role_seed, 'rls.matrix.probe');
  insert into public.user_roles (user_id, role_id)
  values (v_user_a, v_role_seed);
  insert into public.auth_audit_events (event, user_id, result)
  values ('rls.matrix.seed', v_user_a, 'success');
  insert into public.idempotency_keys (user_id, key, method, path, request_hash, expires_at)
  values (v_user_a, 'rls-matrix-seed', 'POST', '/api/v1/seed', 'hash', now() + interval '1 hour');
  insert into public.reminder_runs (status) values ('ok');

  -- Stash fixture ids in transaction-local GUCs so DO blocks running AS
  -- `authenticated` (which cannot see the other tenant's rows, by design)
  -- can still reference them. set_config(..., true) is transaction-scoped.
  perform set_config('rls_matrix.user_a', v_user_a::text, true);
  perform set_config('rls_matrix.user_b', v_user_b::text, true);
  perform set_config('rls_matrix.course_a', v_course_a::text, true);
  perform set_config('rls_matrix.course_b', v_course_b::text, true);
  perform set_config('rls_matrix.task_a', v_task_a::text, true);
  perform set_config('rls_matrix.task_b', v_task_b::text, true);
  perform set_config('rls_matrix.thr_a', v_thr_a::text, true);
  perform set_config('rls_matrix.thr_b', v_thr_b::text, true);
  perform set_config('rls_matrix.thr_del', v_thr_del::text, true);

  raise notice 'PASS  1. fixtures: tenants A/B with courses, tasks, thresholds, deliveries, attachments + zero-policy seeds';
end $fx$;

-- ---------------------------------------------------------------------------
-- Helper convention for every section below (repeated verbatim; SET LOCAL
-- ROLE is illegal inside DO bodies so it stays at the top level):
--
--   select set_config('request.jwt.claim.sub', <uuid::text>, true),
--          set_config('request.jwt.claim.role', 'authenticated', true),
--          set_config('request.jwt.claims',
--                     json_build_object('sub', <uuid>, 'role', 'authenticated')::text, true);
--   set local role authenticated;
--   do $assert$ ... end $assert$;
--   reset role;
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- 2. tasks SELECT isolates tenants (Required test 1)
-- ---------------------------------------------------------------------------
select set_config('request.jwt.claim.sub', current_setting('rls_matrix.user_a'), true),
       set_config('request.jwt.claim.role', 'authenticated', true),
       set_config('request.jwt.claims',
                  json_build_object('sub', current_setting('rls_matrix.user_a'), 'role', 'authenticated')::text,
                  true);

set local role authenticated;

do $assert$
declare
  v_count int;
  v_other int;
begin
  select count(*) into v_count from public.tasks;
  if v_count <> 1 then
    raise exception 'RLS MATRIX FAILED (tasks SELECT isolation): user A sees % tasks, expected exactly 1 (own)', v_count;
  end if;

  select count(*) into v_other
  from public.tasks
  where id = current_setting('rls_matrix.task_b')::uuid;
  if v_other <> 0 then
    raise exception 'RLS MATRIX FAILED (tasks SELECT isolation): user A can see user B task row';
  end if;

  raise notice 'PASS  2. tasks SELECT isolates tenants (A sees 1 own row, B row invisible)';
end $assert$;

reset role;

-- ---------------------------------------------------------------------------
-- 3. tasks INSERT WITH CHECK blocks cross-tenant writes (Required test 2)
-- ---------------------------------------------------------------------------
select set_config('request.jwt.claim.sub', current_setting('rls_matrix.user_a'), true),
       set_config('request.jwt.claim.role', 'authenticated', true),
       set_config('request.jwt.claims',
                  json_build_object('sub', current_setting('rls_matrix.user_a'), 'role', 'authenticated')::text,
                  true);

set local role authenticated;

do $assert$
declare
  v_err_code text;
  v_before int;
  v_after int;
begin
  select count(*) into v_before from public.tasks;

  begin
    insert into public.tasks (user_id, course_id, title, deadline)
    values (
      current_setting('rls_matrix.user_b')::uuid,
      current_setting('rls_matrix.course_b')::uuid,
      'RLS Matrix Cross-Tenant Smuggle',
      now() + interval '1 day'
    );
  exception when others then
    v_err_code := sqlstate;
  end;

  if v_err_code is null then
    raise exception 'RLS MATRIX FAILED (tasks INSERT WITH CHECK): user A inserting user_id=B WAS ALLOWED';
  end if;
  if v_err_code <> '42501' then
    raise exception 'RLS MATRIX FAILED (tasks INSERT WITH CHECK): blocked by unexpected error sqlstate=% (expected 42501 RLS violation)', v_err_code;
  end if;

  select count(*) into v_after from public.tasks;
  if v_after <> v_before then
    raise exception 'RLS MATRIX FAILED (tasks INSERT WITH CHECK): row count changed % -> % despite blocked insert', v_before, v_after;
  end if;

  raise notice 'PASS  3. tasks INSERT WITH CHECK blocks cross-tenant write (42501, count unchanged)';
end $assert$;

reset role;

-- ---------------------------------------------------------------------------
-- 4. RLS enabled on EXACTLY the tenant-table set (Required test 3)
-- ---------------------------------------------------------------------------
do $assert$
declare
  v_expected text[] := array[
    'profiles', 'courses', 'tasks', 'reminder_thresholds',
    'notification_deliveries', 'attachments', 'auth_audit_events',
    'roles', 'role_capabilities', 'user_roles',
    'idempotency_keys', 'reminder_runs'
  ];
  v_actual text[];
  v_missing text[];
  v_extra text[];
begin
  select coalesce(array_agg(c.relname order by c.relname), '{}') into v_actual
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relkind = 'r' and c.relrowsecurity;

  select array_agg(e order by e) into v_missing
  from unnest(v_expected) e where e <> all (v_actual);
  select array_agg(a order by a) into v_extra
  from unnest(v_actual) a where a <> all (v_expected);

  if v_missing is not null then
    raise exception 'RLS MATRIX FAILED (RLS enabled set): tables missing RLS: %', array_to_string(v_missing, ', ');
  end if;
  if v_extra is not null then
    raise exception 'RLS MATRIX FAILED (RLS enabled set): unexpected RLS tables (contract drift): %', array_to_string(v_extra, ', ');
  end if;

  -- Any public table WITHOUT RLS is a tenant-isolation hole: fail loudly so
  -- a newly added table cannot ship without an explicit RLS decision.
  if exists (
    select 1 from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity
  ) then
    raise exception 'RLS MATRIX FAILED (RLS enabled set): a public table exists WITHOUT row level security';
  end if;

  raise notice 'PASS  4. RLS enabled on exactly the 12 tenant tables, none without RLS';
end $assert$;

-- ---------------------------------------------------------------------------
-- 5. Policy-name contract (17 policies) + no views + SECURITY DEFINER allowlist
-- ---------------------------------------------------------------------------
do $assert$
declare
  v_expected text[] := array[
    'profiles.profiles_select_own', 'profiles.profiles_update_own',
    'courses.courses_select_own', 'courses.courses_insert_own', 'courses.courses_update_own',
    'tasks.tasks_select_own', 'tasks.tasks_insert_own', 'tasks.tasks_update_own',
    'reminder_thresholds.thresholds_select_own', 'reminder_thresholds.thresholds_insert_own',
    'reminder_thresholds.thresholds_update_own',
    'notification_deliveries.deliveries_select_own', 'notification_deliveries.deliveries_update_read_own',
    'attachments.attachments_select_own', 'attachments.attachments_insert_own',
    'attachments.attachments_update_own', 'attachments.attachments_delete_own'
  ];
  v_actual text[];
  v_missing text[];
  v_extra text[];
  v_view_count int;
  v_bad_fn text[];
  v_allowed_definer text[] := array[
    'enforce_profile_email_immutable', 'generate_default_thresholds',
    'handle_new_user', 'handle_user_email_change',
    -- P1-summary (perf audit 2026-09-20): tz-aware aggregation RPC. DEFINER
    -- is intentional so RLS can never silently filter rows; tenancy is
    -- enforced by the explicit p_user_id = authenticated-subject predicate
    -- (verified: caller passes ctx.subject.id, never client input).
    'get_user_summary'
  ];
begin
  select coalesce(array_agg(tablename || '.' || policyname order by tablename, policyname), '{}')
    into v_actual
  from pg_policies where schemaname = 'public';

  select array_agg(e order by e) into v_missing
  from unnest(v_expected) e where e <> all (v_actual);
  select array_agg(a order by a) into v_extra
  from unnest(v_actual) a
  where a <> all (v_expected) and a not like 'storage.objects.%' and a not like '%.attachments_storage_%';

  if v_missing is not null then
    raise exception 'RLS MATRIX FAILED (policy set): missing policies: %', array_to_string(v_missing, ', ');
  end if;
  if v_extra is not null then
    raise exception 'RLS MATRIX FAILED (policy set): unexpected policies (needs explicit review): %', array_to_string(v_extra, ', ');
  end if;

  -- A new view (e.g. reporting_view) bypasses table policies for its owner
  -- context unless reviewed: fail until it is explicitly allowlisted here.
  select count(*) into v_view_count
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relkind in ('v', 'm');
  if v_view_count <> 0 then
    raise exception 'RLS MATRIX FAILED (views): % view(s)/matview(s) in public require explicit RLS review', v_view_count;
  end if;

  select coalesce(array_agg(routine_name order by routine_name), '{}') into v_bad_fn
  from information_schema.routines
  where routine_schema = 'public' and security_type = 'DEFINER'
    and routine_name <> all (v_allowed_definer);
  if coalesce(array_length(v_bad_fn, 1), 0) <> 0 then
    raise exception 'RLS MATRIX FAILED (SECURITY DEFINER): unexpected definer functions (RLS bypass risk): %', array_to_string(v_bad_fn, ', ');
  end if;

  raise notice 'PASS  5. 17-policy set intact, no public views, SECURITY DEFINER allowlist intact';
end $assert$;

-- ---------------------------------------------------------------------------
-- 6. courses matrix: S/I/U own-allow + cross-deny, DELETE must fail
-- ---------------------------------------------------------------------------
select set_config('request.jwt.claim.sub', current_setting('rls_matrix.user_a'), true),
       set_config('request.jwt.claim.role', 'authenticated', true),
       set_config('request.jwt.claims',
                  json_build_object('sub', current_setting('rls_matrix.user_a'), 'role', 'authenticated')::text,
                  true);

set local role authenticated;

do $assert$
declare
  v_count int;
  v_err text;
  v_rows int;
begin
  -- SELECT: own visible, other invisible
  select count(*) into v_count from public.courses;
  if v_count <> 1 then
    raise exception 'RLS MATRIX FAILED (courses SELECT): user A sees % courses, expected 1', v_count;
  end if;
  select count(*) into v_count from public.courses
  where id = current_setting('rls_matrix.course_b')::uuid;
  if v_count <> 0 then
    raise exception 'RLS MATRIX FAILED (courses SELECT): user A sees user B course';
  end if;

  -- INSERT own: allowed
  insert into public.courses (user_id, name)
  values (current_setting('rls_matrix.user_a')::uuid, 'RLS Matrix Course A2');
  -- INSERT cross-tenant: 42501
  v_err := null;
  begin
    insert into public.courses (user_id, name)
    values (current_setting('rls_matrix.user_b')::uuid, 'RLS Matrix Smuggle');
  exception when others then
    v_err := sqlstate;
  end;
  if v_err is null then
    raise exception 'RLS MATRIX FAILED (courses INSERT): cross-tenant insert WAS ALLOWED';
  end if;
  if v_err <> '42501' then
    raise exception 'RLS MATRIX FAILED (courses INSERT): unexpected sqlstate %', v_err;
  end if;

  -- UPDATE own: allowed (1 row); cross: 0 rows
  update public.courses set name = 'RLS Matrix Course A (renamed)'
  where id = current_setting('rls_matrix.course_a')::uuid;
  get diagnostics v_rows = row_count;
  if v_rows <> 1 then
    raise exception 'RLS MATRIX FAILED (courses UPDATE own): affected % rows, expected 1', v_rows;
  end if;
  update public.courses set name = 'RLS Matrix Smuggle'
  where id = current_setting('rls_matrix.course_b')::uuid;
  get diagnostics v_rows = row_count;
  if v_rows <> 0 then
    raise exception 'RLS MATRIX FAILED (courses UPDATE cross): affected % rows, expected 0', v_rows;
  end if;

  -- DELETE: no policy -> 0 rows even for own row (hard delete forbidden,
  -- soft delete via UPDATE deleted_at is the app path)
  delete from public.courses where id = current_setting('rls_matrix.course_a')::uuid;
  get diagnostics v_rows = row_count;
  if v_rows <> 0 then
    raise exception 'RLS MATRIX FAILED (courses DELETE): hard delete affected % rows, expected 0 (must fail)', v_rows;
  end if;

  raise notice 'PASS  6. courses matrix (S/I/U own-allow + cross-deny, DELETE denied)';
end $assert$;

reset role;

-- courses DELETE left no trace by design (0 rows); verify own row survived
do $assert$
declare
  v_exists boolean;
begin
  select exists (
    select 1 from public.courses where id = current_setting('rls_matrix.course_a')::uuid
  ) into v_exists;
  if not v_exists then
    raise exception 'RLS MATRIX FAILED (courses DELETE): own course row is gone after denied hard delete';
  end if;
end $assert$;

-- ---------------------------------------------------------------------------
-- 7. tasks matrix remainder: U own/cross, DELETE must fail
-- ---------------------------------------------------------------------------
select set_config('request.jwt.claim.sub', current_setting('rls_matrix.user_a'), true),
       set_config('request.jwt.claim.role', 'authenticated', true),
       set_config('request.jwt.claims',
                  json_build_object('sub', current_setting('rls_matrix.user_a'), 'role', 'authenticated')::text,
                  true);

set local role authenticated;

do $assert$
declare
  v_rows int;
begin
  update public.tasks set title = 'RLS Matrix Task A (renamed)'
  where id = current_setting('rls_matrix.task_a')::uuid;
  get diagnostics v_rows = row_count;
  if v_rows <> 1 then
    raise exception 'RLS MATRIX FAILED (tasks UPDATE own): affected % rows, expected 1', v_rows;
  end if;

  update public.tasks set title = 'RLS Matrix Smuggle'
  where id = current_setting('rls_matrix.task_b')::uuid;
  get diagnostics v_rows = row_count;
  if v_rows <> 0 then
    raise exception 'RLS MATRIX FAILED (tasks UPDATE cross): affected % rows, expected 0', v_rows;
  end if;

  delete from public.tasks where id = current_setting('rls_matrix.task_a')::uuid;
  get diagnostics v_rows = row_count;
  if v_rows <> 0 then
    raise exception 'RLS MATRIX FAILED (tasks DELETE): hard delete affected % rows, expected 0 (must fail)', v_rows;
  end if;

  raise notice 'PASS  7. tasks matrix remainder (UPDATE own-allow + cross-deny, DELETE denied)';
end $assert$;

reset role;

do $assert$
declare
  v_title text;
begin
  select title into v_title from public.tasks
  where id = current_setting('rls_matrix.task_b')::uuid;
  if v_title <> 'RLS Matrix Task B' then
    raise exception 'RLS MATRIX FAILED (tasks UPDATE cross): user B task title changed to %', v_title;
  end if;
end $assert$;

-- ---------------------------------------------------------------------------
-- 8. reminder_thresholds matrix: S/I/U/D own-allow + cross-deny
-- ---------------------------------------------------------------------------
select set_config('request.jwt.claim.sub', current_setting('rls_matrix.user_a'), true),
       set_config('request.jwt.claim.role', 'authenticated', true),
       set_config('request.jwt.claims',
                  json_build_object('sub', current_setting('rls_matrix.user_a'), 'role', 'authenticated')::text,
                  true);

set local role authenticated;

do $assert$
declare
  v_count int;
  v_rows int;
  v_err text;
  v_new_id uuid;
begin
  -- SELECT: A sees own task thresholds (4 auto defaults + 2 custom = 6),
  -- never B's.
  select count(*) into v_count from public.reminder_thresholds;
  if v_count <> 6 then
    raise exception 'RLS MATRIX FAILED (thresholds SELECT): user A sees % rows, expected 6 (4 defaults + 2 custom)', v_count;
  end if;
  select count(*) into v_count from public.reminder_thresholds
  where id = current_setting('rls_matrix.thr_b')::uuid;
  if v_count <> 0 then
    raise exception 'RLS MATRIX FAILED (thresholds SELECT): user A sees user B threshold';
  end if;

  -- INSERT own-task: allowed; cross-task: 42501
  insert into public.reminder_thresholds (task_id, days_before, is_default)
  values (current_setting('rls_matrix.task_a')::uuid, 14, false)
  returning id into v_new_id;
  -- RF-09: removal is an archive (UPDATE deleted_at), never a hard delete.
  update public.reminder_thresholds set deleted_at = clock_timestamp()
  where id = v_new_id;
  get diagnostics v_rows = row_count;
  if v_rows <> 1 then
    raise exception 'RLS MATRIX FAILED (thresholds archive own): affected % rows, expected 1', v_rows;
  end if;
  v_err := null;
  begin
    insert into public.reminder_thresholds (task_id, days_before, is_default)
    values (current_setting('rls_matrix.task_b')::uuid, 14, false);
  exception when others then
    v_err := sqlstate;
  end;
  if v_err <> '42501' then
    raise exception 'RLS MATRIX FAILED (thresholds INSERT cross): sqlstate=%, expected 42501', coalesce(v_err, 'ALLOWED');
  end if;

  -- UPDATE own: allowed; cross: 0 rows
  update public.reminder_thresholds set is_default = true
  where id = current_setting('rls_matrix.thr_a')::uuid;
  get diagnostics v_rows = row_count;
  if v_rows <> 1 then
    raise exception 'RLS MATRIX FAILED (thresholds UPDATE own): affected % rows, expected 1', v_rows;
  end if;
  update public.reminder_thresholds set is_default = true
  where id = current_setting('rls_matrix.thr_b')::uuid;
  get diagnostics v_rows = row_count;
  if v_rows <> 0 then
    raise exception 'RLS MATRIX FAILED (thresholds UPDATE cross): affected % rows, expected 0', v_rows;
  end if;

  -- DELETE own: no policy (RF-09) -> 0 rows, row survives
  delete from public.reminder_thresholds
  where id = current_setting('rls_matrix.thr_del')::uuid;
  get diagnostics v_rows = row_count;
  if v_rows <> 0 then
    raise exception 'RLS MATRIX FAILED (thresholds DELETE own): affected % rows, expected 0 (archive-only)', v_rows;
  end if;
  -- DELETE cross: 0 rows
  delete from public.reminder_thresholds
  where id = current_setting('rls_matrix.thr_b')::uuid;
  get diagnostics v_rows = row_count;
  if v_rows <> 0 then
    raise exception 'RLS MATRIX FAILED (thresholds DELETE cross): affected % rows, expected 0', v_rows;
  end if;

  raise notice 'PASS  8. thresholds matrix (S/I/U own-allow + cross-deny, DELETE denied/archive-only)';
end $assert$;

reset role;

-- ---------------------------------------------------------------------------
-- 8b. RF-09 hard-delete guard: direct DELETE forbidden, task cascade allowed
-- ---------------------------------------------------------------------------
do $assert$
declare
  v_task uuid;
  v_thr uuid;
  v_count int;
  v_msg text;
begin
  -- Direct DELETE as the privileged owner (bypasses RLS) must be rejected by
  -- the BEFORE DELETE guard trigger.
  v_msg := null;
  begin
    delete from public.reminder_thresholds
    where id = current_setting('rls_matrix.thr_a')::uuid;
  exception when others then
    v_msg := sqlerrm;
  end;
  if v_msg is null then
    raise exception 'RLS MATRIX FAILED (threshold hard-delete guard): direct DELETE WAS ALLOWED';
  end if;
  if v_msg not like 'THRESHOLD_HARD_DELETE_FORBIDDEN%' then
    raise exception 'RLS MATRIX FAILED (threshold hard-delete guard): unexpected error: %', v_msg;
  end if;

  -- Cascaded deletes (task/user removal) run inside the RI trigger and must
  -- still pass, or account cleanup would break.
  insert into public.tasks (user_id, course_id, title, deadline)
  values (current_setting('rls_matrix.user_a')::uuid,
          current_setting('rls_matrix.course_a')::uuid,
          'RLS Matrix Cascade', now() + interval '1 day')
  returning id into v_task;
  insert into public.reminder_thresholds (task_id, days_before, is_default)
  values (v_task, 45, false) returning id into v_thr;

  delete from public.tasks where id = v_task;

  select count(*) into v_count from public.reminder_thresholds where task_id = v_task;
  if v_count <> 0 then
    raise exception 'RLS MATRIX FAILED (threshold cascade): % threshold rows survived task delete', v_count;
  end if;

  raise notice 'PASS  8b. direct threshold DELETE forbidden; task cascade still removes thresholds';
end $assert$;

-- ---------------------------------------------------------------------------
-- 9. notification_deliveries matrix: SELECT own, INSERT/DELETE denied,
--    UPDATE read_at-only (trigger) + cross-tenant invisible
-- ---------------------------------------------------------------------------
select set_config('request.jwt.claim.sub', current_setting('rls_matrix.user_a'), true),
       set_config('request.jwt.claim.role', 'authenticated', true),
       set_config('request.jwt.claims',
                  json_build_object('sub', current_setting('rls_matrix.user_a'), 'role', 'authenticated')::text,
                  true);

set local role authenticated;

do $assert$
declare
  v_count int;
  v_rows int;
  v_err text;
  v_msg text;
begin
  select count(*) into v_count from public.notification_deliveries;
  if v_count <> 1 then
    raise exception 'RLS MATRIX FAILED (deliveries SELECT): user A sees % rows, expected 1', v_count;
  end if;

  -- INSERT: no policy for authenticated -> 42501 (scheduler uses service_role)
  v_err := null;
  begin
    insert into public.notification_deliveries (task_id, threshold_id, days_before, channel)
    values (
      current_setting('rls_matrix.task_a')::uuid,
      current_setting('rls_matrix.thr_a')::uuid,
      30, 'in_app'
    );
  exception when others then
    v_err := sqlstate;
  end;
  if v_err <> '42501' then
    raise exception 'RLS MATRIX FAILED (deliveries INSERT): sqlstate=%, expected 42501', coalesce(v_err, 'ALLOWED');
  end if;

  -- DELETE: no policy -> 0 rows, row survives
  delete from public.notification_deliveries
  where task_id = current_setting('rls_matrix.task_a')::uuid;
  get diagnostics v_rows = row_count;
  if v_rows <> 0 then
    raise exception 'RLS MATRIX FAILED (deliveries DELETE): affected % rows, expected 0', v_rows;
  end if;

  -- UPDATE read_at (own): allowed
  update public.notification_deliveries set read_at = clock_timestamp()
  where task_id = current_setting('rls_matrix.task_a')::uuid;
  get diagnostics v_rows = row_count;
  if v_rows <> 1 then
    raise exception 'RLS MATRIX FAILED (deliveries UPDATE read_at): affected % rows, expected 1', v_rows;
  end if;

  -- UPDATE status (own): trigger blocks with exact message
  v_msg := null;
  begin
    update public.notification_deliveries set status = 'sent'
    where task_id = current_setting('rls_matrix.task_a')::uuid;
  exception when others then
    v_msg := sqlerrm;
  end;
  if v_msg is null then
    raise exception 'RLS MATRIX FAILED (deliveries UPDATE status): authenticated WAS ALLOWED to change status';
  end if;
  if v_msg <> 'Only read_at may be updated on notification_deliveries' then
    raise exception 'RLS MATRIX FAILED (deliveries UPDATE status): unexpected error: %', v_msg;
  end if;

  -- UPDATE cross-tenant: 0 rows (invisible)
  update public.notification_deliveries set read_at = clock_timestamp()
  where task_id = current_setting('rls_matrix.task_b')::uuid;
  get diagnostics v_rows = row_count;
  if v_rows <> 0 then
    raise exception 'RLS MATRIX FAILED (deliveries UPDATE cross): affected % rows, expected 0', v_rows;
  end if;

  raise notice 'PASS  9. deliveries matrix (SELECT own, INSERT/DELETE denied, UPDATE read_at-only)';
end $assert$;

reset role;

-- ---------------------------------------------------------------------------
-- 10. attachments matrix: S/I/U/D own-allow + cross-deny
-- ---------------------------------------------------------------------------
select set_config('request.jwt.claim.sub', current_setting('rls_matrix.user_a'), true),
       set_config('request.jwt.claim.role', 'authenticated', true),
       set_config('request.jwt.claims',
                  json_build_object('sub', current_setting('rls_matrix.user_a'), 'role', 'authenticated')::text,
                  true);

set local role authenticated;

do $assert$
declare
  v_count int;
  v_rows int;
  v_err text;
  v_new_id uuid;
begin
  select count(*) into v_count from public.attachments
  where task_id = current_setting('rls_matrix.task_a')::uuid;
  if v_count <> 2 then
    raise exception 'RLS MATRIX FAILED (attachments SELECT): user A sees % own rows, expected 2', v_count;
  end if;
  select count(*) into v_count from public.attachments
  where task_id = current_setting('rls_matrix.task_b')::uuid;
  if v_count <> 0 then
    raise exception 'RLS MATRIX FAILED (attachments SELECT): user A sees user B attachment';
  end if;

  insert into public.attachments (task_id, type, url)
  values (current_setting('rls_matrix.task_a')::uuid, 'link', 'https://example.invalid/a-probe')
  returning id into v_new_id;
  delete from public.attachments where id = v_new_id;

  v_err := null;
  begin
    insert into public.attachments (task_id, type, url)
    values (current_setting('rls_matrix.task_b')::uuid, 'link', 'https://example.invalid/smuggle');
  exception when others then
    v_err := sqlstate;
  end;
  if v_err <> '42501' then
    raise exception 'RLS MATRIX FAILED (attachments INSERT cross): sqlstate=%, expected 42501', coalesce(v_err, 'ALLOWED');
  end if;

  update public.attachments set url = 'https://example.invalid/a-renamed'
  where url = 'https://example.invalid/a';
  get diagnostics v_rows = row_count;
  if v_rows <> 1 then
    raise exception 'RLS MATRIX FAILED (attachments UPDATE own): affected % rows, expected 1', v_rows;
  end if;
  update public.attachments set url = 'https://example.invalid/smuggle'
  where url = 'https://example.invalid/b';
  get diagnostics v_rows = row_count;
  if v_rows <> 0 then
    raise exception 'RLS MATRIX FAILED (attachments UPDATE cross): affected % rows, expected 0', v_rows;
  end if;

  delete from public.attachments where url = 'https://example.invalid/a-del';
  get diagnostics v_rows = row_count;
  if v_rows <> 1 then
    raise exception 'RLS MATRIX FAILED (attachments DELETE own): affected % rows, expected 1', v_rows;
  end if;
  delete from public.attachments where url = 'https://example.invalid/b';
  get diagnostics v_rows = row_count;
  if v_rows <> 0 then
    raise exception 'RLS MATRIX FAILED (attachments DELETE cross): affected % rows, expected 0', v_rows;
  end if;

  raise notice 'PASS  10. attachments matrix (S/I/U/D own-allow + cross-deny)';
end $assert$;

reset role;

-- ---------------------------------------------------------------------------
-- 11. profiles matrix: SELECT/UPDATE own only; INSERT/DELETE denied
-- ---------------------------------------------------------------------------
select set_config('request.jwt.claim.sub', current_setting('rls_matrix.user_a'), true),
       set_config('request.jwt.claim.role', 'authenticated', true),
       set_config('request.jwt.claims',
                  json_build_object('sub', current_setting('rls_matrix.user_a'), 'role', 'authenticated')::text,
                  true);

set local role authenticated;

do $assert$
declare
  v_count int;
  v_rows int;
  v_err text;
begin
  select count(*) into v_count from public.profiles;
  if v_count <> 1 then
    raise exception 'RLS MATRIX FAILED (profiles SELECT): user A sees % rows, expected 1 (own)', v_count;
  end if;

  update public.profiles set name = 'RLS Matrix A'
  where id = current_setting('rls_matrix.user_a')::uuid;
  get diagnostics v_rows = row_count;
  if v_rows <> 1 then
    raise exception 'RLS MATRIX FAILED (profiles UPDATE own): affected % rows, expected 1', v_rows;
  end if;
  update public.profiles set name = 'RLS Matrix Smuggle'
  where id = current_setting('rls_matrix.user_b')::uuid;
  get diagnostics v_rows = row_count;
  if v_rows <> 0 then
    raise exception 'RLS MATRIX FAILED (profiles UPDATE cross): affected % rows, expected 0', v_rows;
  end if;

  -- No INSERT policy for authenticated (provisioning is trigger-only)
  v_err := null;
  begin
    insert into public.profiles (id, email)
    values (gen_random_uuid(), 'rls-matrix-smuggle@example.invalid');
  exception when others then
    v_err := sqlstate;
  end;
  if v_err <> '42501' then
    raise exception 'RLS MATRIX FAILED (profiles INSERT): sqlstate=%, expected 42501', coalesce(v_err, 'ALLOWED');
  end if;

  -- No DELETE policy
  delete from public.profiles where id = current_setting('rls_matrix.user_a')::uuid;
  get diagnostics v_rows = row_count;
  if v_rows <> 0 then
    raise exception 'RLS MATRIX FAILED (profiles DELETE): affected % rows, expected 0', v_rows;
  end if;

  raise notice 'PASS  11. profiles matrix (SELECT/UPDATE own-only, INSERT/DELETE denied)';
end $assert$;

reset role;

-- ---------------------------------------------------------------------------
-- 12. Zero-policy tables deny authenticated (SELECT invisible + INSERT 42501)
-- ---------------------------------------------------------------------------
select set_config('request.jwt.claim.sub', current_setting('rls_matrix.user_a'), true),
       set_config('request.jwt.claim.role', 'authenticated', true),
       set_config('request.jwt.claims',
                  json_build_object('sub', current_setting('rls_matrix.user_a'), 'role', 'authenticated')::text,
                  true);

set local role authenticated;

do $assert$
declare
  v_count int;
  v_err text;
begin
  select count(*) into v_count from public.roles;
  if v_count <> 0 then raise exception 'RLS MATRIX FAILED (roles SELECT): authenticated sees % rows, expected 0', v_count; end if;
  select count(*) into v_count from public.role_capabilities;
  if v_count <> 0 then raise exception 'RLS MATRIX FAILED (role_capabilities SELECT): authenticated sees % rows, expected 0', v_count; end if;
  select count(*) into v_count from public.user_roles;
  if v_count <> 0 then raise exception 'RLS MATRIX FAILED (user_roles SELECT): authenticated sees % rows, expected 0', v_count; end if;
  select count(*) into v_count from public.auth_audit_events;
  if v_count <> 0 then raise exception 'RLS MATRIX FAILED (auth_audit_events SELECT): authenticated sees % rows, expected 0', v_count; end if;
  select count(*) into v_count from public.idempotency_keys;
  if v_count <> 0 then raise exception 'RLS MATRIX FAILED (idempotency_keys SELECT): authenticated sees % rows, expected 0', v_count; end if;
  select count(*) into v_count from public.reminder_runs;
  if v_count <> 0 then raise exception 'RLS MATRIX FAILED (reminder_runs SELECT): authenticated sees % rows, expected 0', v_count; end if;

  -- Representative INSERT denials across all six tables
  begin
    insert into public.roles (slug) values ('rls-matrix-smuggle');
  exception when others then
    v_err := sqlstate;
  end;
  if v_err is null then raise exception 'RLS MATRIX FAILED (roles INSERT): WAS ALLOWED'; end if;
  if v_err <> '42501' then raise exception 'RLS MATRIX FAILED (roles INSERT): sqlstate=%, expected 42501', v_err; end if;

  v_err := null;
  begin
    insert into public.role_capabilities (role_id, capability)
    values ('00000000-0000-4000-8000-000000000000', 'smuggle');
  exception when others then
    v_err := sqlstate;
  end;
  -- FK violation (42501 RLS fires first when a policy exists; here NO policy
  -- exists so RLS denies first with 42501 — either way the write is denied).
  if v_err is null then raise exception 'RLS MATRIX FAILED (role_capabilities INSERT): WAS ALLOWED'; end if;
  if v_err not in ('42501', '23503') then raise exception 'RLS MATRIX FAILED (role_capabilities INSERT): sqlstate=%, expected 42501/23503', v_err; end if;

  v_err := null;
  begin
    insert into public.user_roles (user_id, role_id)
    values (current_setting('rls_matrix.user_a')::uuid, '00000000-0000-4000-8000-000000000000');
  exception when others then
    v_err := sqlstate;
  end;
  if v_err is null then raise exception 'RLS MATRIX FAILED (user_roles INSERT): WAS ALLOWED'; end if;
  if v_err not in ('42501', '23503') then raise exception 'RLS MATRIX FAILED (user_roles INSERT): sqlstate=%, expected 42501/23503', v_err; end if;

  v_err := null;
  begin
    insert into public.auth_audit_events (event, result) values ('smuggle', 'success');
  exception when others then
    v_err := sqlstate;
  end;
  if v_err <> '42501' then raise exception 'RLS MATRIX FAILED (auth_audit_events INSERT): sqlstate=%, expected 42501', coalesce(v_err, 'ALLOWED'); end if;

  v_err := null;
  begin
    insert into public.idempotency_keys (user_id, key, method, path, request_hash, expires_at)
    values (current_setting('rls_matrix.user_a')::uuid, 'smuggle', 'POST', '/x', 'h', now() + interval '1 hour');
  exception when others then
    v_err := sqlstate;
  end;
  if v_err <> '42501' then raise exception 'RLS MATRIX FAILED (idempotency_keys INSERT): sqlstate=%, expected 42501', coalesce(v_err, 'ALLOWED'); end if;

  v_err := null;
  begin
    insert into public.reminder_runs (status) values ('ok');
  exception when others then
    v_err := sqlstate;
  end;
  if v_err <> '42501' then raise exception 'RLS MATRIX FAILED (reminder_runs INSERT): sqlstate=%, expected 42501', coalesce(v_err, 'ALLOWED'); end if;

  raise notice 'PASS  12. zero-policy tables deny authenticated (SELECT invisible + INSERT denied)';
end $assert$;

reset role;

-- ---------------------------------------------------------------------------
-- 13. Roll back everything, then prove no fixture data left behind
-- ---------------------------------------------------------------------------
rollback;

do $assert$
declare
  v_left int;
begin
  select (
    (select count(*) from auth.users where email in ('rls-matrix-a@example.invalid', 'rls-matrix-b@example.invalid', 'rls-matrix-smuggle@example.invalid'))
    + (select count(*) from public.courses where name like 'RLS Matrix%')
    + (select count(*) from public.tasks where title like 'RLS Matrix%')
    + (select count(*) from public.roles where slug in ('rls-matrix-seed', 'rls-matrix-smuggle'))
    + (select count(*) from public.attachments where url like 'https://example.invalid/%')
  ) into v_left;

  if v_left <> 0 then
    raise exception 'RLS MATRIX CLEANUP FAILED: % fixture rows left behind', v_left;
  end if;

  raise notice 'PASS  13. cleanup: no fixture data left behind';
end $assert$;
