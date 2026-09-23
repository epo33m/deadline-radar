-- M-4: notification_deliveries days_before snapshot & updated unique constraint.
-- Delivery is a historical/state record that preserves the offset context under
-- which it was produced. Mutating reminder_thresholds (e.g. H-3 -> H-5) must not
-- suppress future reminders or alter historical in-app notifications.

-- 1. Add days_before column (nullable initially for safe backfill)
alter table public.notification_deliveries
  add column if not exists days_before integer;

-- 2. Safely backfill existing data directly from the associated reminder_thresholds row.
-- All existing deliveries reference a valid threshold_id via FK.
update public.notification_deliveries nd
set days_before = rt.days_before
from public.reminder_thresholds rt
where nd.threshold_id = rt.id
  and nd.days_before is null;

-- 3. Fail-safe validation: halt if any row could not be deterministically resolved.
do $$
begin
  if exists (
    select 1 from public.notification_deliveries
    where days_before is null or days_before < 0 or days_before > 365
  ) then
    raise exception 'M-4 backfill failed: notification_deliveries contains null or out-of-range days_before';
  end if;
end $$;

-- 4. Enforce NOT NULL and valid range check
alter table public.notification_deliveries
  alter column days_before set not null;

alter table public.notification_deliveries
  add constraint notification_deliveries_days_before_check
  check (days_before >= 0 and days_before <= 365);

-- 5. Drop old unique (threshold_id, channel) constraint and create
-- composite unique (threshold_id, days_before, channel).
alter table public.notification_deliveries
  drop constraint if exists notification_deliveries_threshold_id_channel_key;

alter table public.notification_deliveries
  drop constraint if exists notification_deliveries_threshold_id_channel_unique;

alter table public.notification_deliveries
  add constraint notification_deliveries_threshold_id_days_before_channel_key
  unique (threshold_id, days_before, channel);

-- 6. Update trigger enforce_delivery_read_at_only to guard days_before as immutable for clients.
create or replace function public.enforce_delivery_read_at_only()
returns trigger
language plpgsql
as $$
begin
  -- Privileged writer: PostgREST service_role JWT OR direct privileged connection.
  if auth.role() = 'service_role'
     or pg_has_role(current_user, 'service_role', 'member') then
    return new;
  end if;

  -- Everyone else (authenticated / anon) may only change read_at.
  if new.task_id is distinct from old.task_id
     or new.threshold_id is distinct from old.threshold_id
     or new.days_before is distinct from old.days_before
     or new.channel is distinct from old.channel
     or new.status is distinct from old.status
     or new.retry_count is distinct from old.retry_count
     or new.sent_at is distinct from old.sent_at
     or new.created_at is distinct from old.created_at then
    raise exception 'Only read_at may be updated on notification_deliveries';
  end if;

  return new;
end;
$$;
