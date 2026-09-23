-- BUG-01: Restore default 'user' role assignment in handle_new_user()
-- while preserving email normalization (lower(trim(email))) from 20260920030000.

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
  values (new.id, lower(trim(new.email)));

  select id into user_role_id from public.roles where slug = 'user' limit 1;
  if user_role_id is not null then
    insert into public.user_roles (user_id, role_id)
    values (new.id, user_role_id)
    on conflict (user_id, role_id) do nothing;
  end if;

  return new;
end;
$$;

-- Safe backfill: assign default 'user' role to profiles that currently have no role assigned
insert into public.user_roles (user_id, role_id)
select p.id, r.id
from public.profiles p
cross join public.roles r
where r.slug = 'user'
  and not exists (
    select 1 from public.user_roles ur where ur.user_id = p.id
  )
on conflict (user_id, role_id) do nothing;
