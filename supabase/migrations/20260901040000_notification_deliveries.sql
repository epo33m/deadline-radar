-- Issue #9: notification_deliveries + enums, owner SELECT / read_at UPDATE RLS.
-- Inserts and status updates are performed by the scheduler via service_role.

do $$ begin
  create type public.notification_channel as enum ('email', 'in_app');
exception
  when duplicate_object then null;
end $$;

do $$ begin
  create type public.notification_status as enum ('pending', 'sent', 'failed');
exception
  when duplicate_object then null;
end $$;

create table if not exists public.notification_deliveries (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references public.tasks (id) on delete cascade,
  threshold_id uuid not null references public.reminder_thresholds (id) on delete cascade,
  channel public.notification_channel not null,
  status public.notification_status not null default 'pending',
  retry_count integer not null default 0 check (retry_count >= 0),
  sent_at timestamptz,
  read_at timestamptz,
  created_at timestamptz not null default now(),
  unique (threshold_id, channel)
);

create index if not exists idx_notification_deliveries_task_id
  on public.notification_deliveries (task_id);

create index if not exists idx_notification_deliveries_status
  on public.notification_deliveries (status);

alter table public.notification_deliveries enable row level security;

drop policy if exists "deliveries_select_own" on public.notification_deliveries;
drop policy if exists "deliveries_update_read_own" on public.notification_deliveries;

-- Users may read their own deliveries (via task ownership).
create policy "deliveries_select_own"
  on public.notification_deliveries
  for select
  using (
    task_id in (select id from public.tasks where user_id = auth.uid())
  );

-- Users may update their own rows (app only sets read_at for in_app).
create policy "deliveries_update_read_own"
  on public.notification_deliveries
  for update
  using (
    task_id in (select id from public.tasks where user_id = auth.uid())
  )
  with check (
    task_id in (select id from public.tasks where user_id = auth.uid())
  );

-- Authenticated users may only change read_at; service_role bypasses RLS entirely.
create or replace function public.enforce_delivery_read_at_only()
returns trigger
language plpgsql
as $$
begin
  -- service_role still runs triggers; allow full updates for the scheduler.
  if auth.role() = 'service_role' then
    return new;
  end if;
  if new.task_id is distinct from old.task_id
     or new.threshold_id is distinct from old.threshold_id
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

drop trigger if exists notification_deliveries_read_at_only
  on public.notification_deliveries;
create trigger notification_deliveries_read_at_only
  before update on public.notification_deliveries
  for each row execute function public.enforce_delivery_read_at_only();

-- No INSERT/DELETE policies for authenticated users: scheduler uses service_role.
