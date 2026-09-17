-- RBAC seed: profile.time-format.update for user + admin roles.
-- Idempotent: safe to re-apply.

insert into public.role_capabilities (role_id, capability)
select r.id, c.capability
from public.roles r
cross join (values ('profile.time-format.update')) as c(capability)
where r.slug in ('user', 'admin')
on conflict (role_id, capability) do nothing;
