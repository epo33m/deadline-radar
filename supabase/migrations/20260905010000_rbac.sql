-- RBAC: roles, role_capabilities, user_roles.
-- Written/read by the API service DB role. No client RLS policies (fail closed).
-- Role inheritance: none. Tenant isolation: N/A (per-profile ownership).

create table if not exists public.roles (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  description text,
  created_at timestamptz not null default now()
);

create table if not exists public.role_capabilities (
  id uuid primary key default gen_random_uuid(),
  role_id uuid not null references public.roles (id) on delete cascade,
  capability text not null,
  created_at timestamptz not null default now(),
  unique (role_id, capability)
);

create table if not exists public.user_roles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  role_id uuid not null references public.roles (id) on delete cascade,
  assigned_at timestamptz not null default now(),
  assigned_by uuid references public.profiles (id) on delete set null,
  unique (user_id, role_id)
);

create index if not exists idx_user_roles_user_id on public.user_roles (user_id);
create index if not exists idx_role_capabilities_role_id on public.role_capabilities (role_id);

-- Stable seed IDs for roles
insert into public.roles (id, slug, description)
values
  (
    'a0000000-0000-4000-8000-000000000001',
    'user',
    'Default authenticated user; owns personal courses and tasks'
  ),
  (
    'a0000000-0000-4000-8000-000000000002',
    'admin',
    'Administrative operations: role assign/revoke and audit view'
  )
on conflict (slug) do nothing;

-- Domain capabilities for both user and admin
insert into public.role_capabilities (role_id, capability)
select r.id, c.capability
from public.roles r
cross join (
  values
    ('course.view'),
    ('course.create'),
    ('course.update'),
    ('course.archive'),
    ('task.view'),
    ('task.create'),
    ('task.update'),
    ('task.archive'),
    ('threshold.manage'),
    ('attachment.create'),
    ('attachment.delete'),
    ('attachment.signed-url'),
    ('notification.view'),
    ('notification.mark-read'),
    ('profile.view'),
    ('profile.timezone.update')
) as c(capability)
where r.slug in ('user', 'admin')
on conflict (role_id, capability) do nothing;

-- Admin-only capabilities
insert into public.role_capabilities (role_id, capability)
select r.id, c.capability
from public.roles r
cross join (
  values
    ('role.assign'),
    ('role.revoke'),
    ('audit.view')
) as c(capability)
where r.slug = 'admin'
on conflict (role_id, capability) do nothing;

-- Backfill default user role for existing profiles
insert into public.user_roles (user_id, role_id)
select p.id, r.id
from public.profiles p
cross join public.roles r
where r.slug = 'user'
on conflict (user_id, role_id) do nothing;

-- Assign default user role when a profile is provisioned
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  user_role_id uuid;
begin
  insert into public.profiles (id, email)
  values (new.id, new.email);

  select id into user_role_id from public.roles where slug = 'user' limit 1;
  if user_role_id is not null then
    insert into public.user_roles (user_id, role_id)
    values (new.id, user_role_id)
    on conflict (user_id, role_id) do nothing;
  end if;

  return new;
end;
$$;

alter table public.roles enable row level security;
alter table public.role_capabilities enable row level security;
alter table public.user_roles enable row level security;

-- No client policies: only the privileged API role reads/writes via DATABASE_URL.
-- For RLS to enforce on API ownership lookups (withUserRls sets request.jwt.claim.*),
-- use a DATABASE_URL role without BYPASSRLS. Superuser/service_role still bypasses RLS.
