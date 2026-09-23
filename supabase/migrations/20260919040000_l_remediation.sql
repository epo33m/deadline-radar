-- Remediation Migration for Findings L-1, L-2, L-5, L-8, L-10
--
-- 1. L-1: Drop redundant indexes covered by leading column of UNIQUE constraints
-- 2. L-2: Drop unused/low-selectivity indexes superseded by composite/filtered indexes
-- 3. L-5: Enforce profiles timezone validity and prevent direct email drift via trigger
-- 4. L-8: Add updated_at to profiles for timestamp parity and optimistic concurrency
-- 5. L-10: Add database-level string length check constraints for defense-in-depth

-- ---------------------------------------------------------------------------
-- 1. L-1: Drop redundant indexes
-- ---------------------------------------------------------------------------
drop index if exists public.idx_reminder_thresholds_task_id;
drop index if exists public.idx_role_capabilities_role_id;
drop index if exists public.idx_user_roles_user_id;

-- ---------------------------------------------------------------------------
-- 2. L-2: Drop unused/low-selectivity indexes
-- ---------------------------------------------------------------------------
drop index if exists public.idx_tasks_status;
drop index if exists public.idx_notification_deliveries_status;
drop index if exists public.idx_courses_user_id;

-- ---------------------------------------------------------------------------
-- 3. L-5 & L-8: Profiles table hardening (updated_at, timezone validation, email drift prevention)
-- ---------------------------------------------------------------------------
alter table public.profiles
  add column if not exists updated_at timestamptz not null default now();

create or replace function public.is_valid_timezone(tz text)
returns boolean
language plpgsql
immutable
as $$
begin
  if tz is null or trim(tz) = '' then
    return false;
  end if;
  perform now() at time zone tz;
  return true;
exception
  when others then
    return false;
end;
$$;

alter table public.profiles
  drop constraint if exists profiles_timezone_valid_check;

alter table public.profiles
  add constraint profiles_timezone_valid_check check (
    public.is_valid_timezone(timezone)
  );

create or replace function public.enforce_profile_email_immutable()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Block authenticated users from directly mutating email on public.profiles.
  -- Legitimate email updates MUST flow through auth.users confirmation trigger (handle_user_email_change).
  if auth.role() = 'authenticated' and new.email is distinct from old.email then
    raise exception 'Direct modification of profiles.email is forbidden. Use auth email change workflow.';
  end if;
  return new;
end;
$$;

drop trigger if exists on_profiles_email_immutable on public.profiles;
create trigger on_profiles_email_immutable
  before update of email on public.profiles
  for each row execute function public.enforce_profile_email_immutable();

-- ---------------------------------------------------------------------------
-- 4. L-10: String length check constraints (defense-in-depth)
-- ---------------------------------------------------------------------------
alter table public.profiles
  drop constraint if exists profiles_name_length_check;
alter table public.profiles
  add constraint profiles_name_length_check check (
    name is null or char_length(name) <= 255
  );

alter table public.attachments
  drop constraint if exists attachments_notes_length_check;
alter table public.attachments
  add constraint attachments_notes_length_check check (
    notes is null or char_length(notes) <= 1000
  );

alter table public.roles
  drop constraint if exists roles_slug_length_check;
alter table public.roles
  add constraint roles_slug_length_check check (
    char_length(slug) <= 64
  );

alter table public.roles
  drop constraint if exists roles_description_length_check;
alter table public.roles
  add constraint roles_description_length_check check (
    description is null or char_length(description) <= 500
  );

alter table public.role_capabilities
  drop constraint if exists role_capabilities_capability_length_check;
alter table public.role_capabilities
  add constraint role_capabilities_capability_length_check check (
    char_length(capability) <= 128
  );

alter table public.idempotency_keys
  drop constraint if exists idempotency_keys_key_length_check;
alter table public.idempotency_keys
  add constraint idempotency_keys_key_length_check check (
    char_length(key) <= 255
  );
