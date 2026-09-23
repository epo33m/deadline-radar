-- RF-09: archive reminder thresholds instead of hard-deleting them.
--
-- Removing a reminder hard-deleted the reminder_thresholds row, and
-- notification_deliveries.threshold_id has ON DELETE CASCADE, so the entire
-- delivery history for that offset (sent/failed rows and the in_app inbox,
-- including read_at) was destroyed. DOMAIN.md §4 already says removals are
-- soft deletes; this migration makes the DB match.
--
-- Design notes:
-- - `deleted_at` mirrors courses/tasks: NULL = live, timestamp = archived.
-- - The old total UNIQUE(task_id, days_before) is replaced by a partial
--   unique index over live rows only, so an archived offset can be re-added
--   later without resurrecting (or colliding with) the archived row. Delivery
--   history then keeps suppressing a re-added, already-sent offset (RF-10).
-- - The quota trigger counts live rows only: archiving frees a slot, exactly
--   like the API counts active thresholds.
-- - Hard DELETE has no legitimate caller. The RLS DELETE policy is dropped
--   (closes the PostgREST path) and a BEFORE DELETE guard trigger closes the
--   privileged/service_role path. The trigger allows nested deletes
--   (pg_trigger_depth() > 1, i.e. an RI cascade; a direct delete fires at
--   depth 1) so task/user removal still cascades cleanly.
-- - Idempotent: IF NOT EXISTS / CREATE OR REPLACE / DROP TRIGGER IF EXISTS
--   (house style).

alter table public.reminder_thresholds
  add column if not exists deleted_at timestamptz;

-- Replace the total unique constraint with an active-only partial index.
alter table public.reminder_thresholds
  drop constraint if exists reminder_thresholds_task_id_days_before_key;

create unique index if not exists reminder_thresholds_task_days_before_active_key
  on public.reminder_thresholds (task_id, days_before)
  where deleted_at is null;

-- Quota backstop (SEC-003) counts live thresholds only.
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
  where task_id = new.task_id
    and deleted_at is null;

  if v_threshold_count >= v_max_thresholds then
    raise exception 'THRESHOLD_QUOTA_EXCEEDED: task already has % thresholds (max %)', v_threshold_count, v_max_thresholds;
  end if;

  return new;
end;
$$;

-- No DELETE policy: hard delete is forbidden; archive via UPDATE deleted_at.
drop policy if exists "thresholds_delete_own" on public.reminder_thresholds;

create or replace function public.forbid_threshold_delete()
returns trigger
language plpgsql
as $$
begin
  -- RI cascade deletes (task/user removal) execute inside an internal
  -- trigger, so pg_trigger_depth() = 2 there. A direct hard DELETE fires
  -- this trigger at depth 1 and must be rejected.
  if pg_trigger_depth() > 1 then
    return old;
  end if;
  raise exception 'THRESHOLD_HARD_DELETE_FORBIDDEN: archive via deleted_at instead';
end;
$$;

drop trigger if exists threshold_forbid_delete on public.reminder_thresholds;
create trigger threshold_forbid_delete
  before delete on public.reminder_thresholds
  for each row execute function public.forbid_threshold_delete();
