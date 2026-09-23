-- SEC-003 / C4: DB-level quota backstop for direct PostgREST writes.
--
-- Application quotas (200 active tasks/user, 10 thresholds/task,
-- packages/domain/src/quotas.ts) are enforced in the API (429s), but RLS
-- WITH CHECK (user_id = auth.uid()) has no count bound, so a direct
-- PostgREST INSERT with the public anon key could create unbounded tasks
-- (each injecting 4 default thresholds via on_task_created) and drain
-- 50 emails/run forever. This migration adds the compensating DB control
-- required by docs/PROD_ENV_CHECKLIST.md gate C4.
--
-- Design notes:
-- - Mirrors the app bounds exactly (200 ACTIVE tasks: deleted_at IS NULL;
--   10 thresholds per task_id). Soft-deleted tasks free their slot, same as
--   the API (POST /tasks counts active only).
-- - Privileged writers bypass via pg_has_role(current_user, 'service_role',
--   'member') — the scheduler (DATABASE_URL) and admin ops are unaffected.
--   Deliberately NOT auth.role(): unlike C-1's read_at guard, a quota check
--   must work on databases whose auth schema lacks USAGE grants for client
--   roles (auth.role() would raise "permission denied for schema auth"
--   instead of applying the quota). PostgREST sets current_user from the JWT
--   role claim, so service_role JWTs still bypass via pg_has_role.
-- - RLS still applies first for cross-tenant writes below quota (42501);
--   above quota, own-context writes fail with the quota message below.
-- - Concurrent-race window (two txns both seeing 199) is accepted: the API
--   remains the primary enforcement; this trigger is the backstop.
-- - UPDATE (un-delete) is out of scope: reactivation past quota stays
--   possible; closing it would complicate soft-delete restores.
-- - Idempotent: CREATE OR REPLACE + DROP TRIGGER IF EXISTS (house style).

create or replace function public.enforce_task_quota()
returns trigger
language plpgsql
as $$
declare
  v_active_count int;
  v_max_tasks int := 200;
begin
  if pg_has_role(current_user, 'service_role', 'member') then
    return new;
  end if;

  -- RLS-filtered count: as `authenticated` only own rows are visible, which
  -- is exactly the per-user quota domain. Cross-tenant NEW.user_id values
  -- count 0 here and are rejected downstream by the WITH CHECK policy.
  select count(*) into v_active_count
  from public.tasks
  where user_id = new.user_id
    and deleted_at is null;

  if v_active_count >= v_max_tasks then
    raise exception 'TASK_QUOTA_EXCEEDED: user already owns % active tasks (max %)', v_active_count, v_max_tasks;
  end if;

  return new;
end;
$$;

drop trigger if exists task_quota_before_insert on public.tasks;
create trigger task_quota_before_insert
  before insert on public.tasks
  for each row execute function public.enforce_task_quota();

create or replace function public.enforce_threshold_quota()
returns trigger
language plpgsql
as $$
declare
  v_threshold_count int;
  v_max_thresholds int := 10;
begin
  if pg_has_role(current_user, 'service_role', 'member') then
    return new;
  end if;

  select count(*) into v_threshold_count
  from public.reminder_thresholds
  where task_id = new.task_id;

  if v_threshold_count >= v_max_thresholds then
    raise exception 'THRESHOLD_QUOTA_EXCEEDED: task already has % thresholds (max %)', v_threshold_count, v_max_thresholds;
  end if;

  return new;
end;
$$;

drop trigger if exists threshold_quota_before_insert on public.reminder_thresholds;
create trigger threshold_quota_before_insert
  before insert on public.reminder_thresholds
  for each row execute function public.enforce_threshold_quota();
