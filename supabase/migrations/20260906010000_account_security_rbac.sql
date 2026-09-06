-- Account security capabilities for authenticated users.
-- Issue #38: signed-in password change and email change (Settings/Preferences).
-- Mirrors the RBAC seed pattern in 20260905010000_rbac.sql.

insert into public.role_capabilities (role_id, capability)
select r.id, c.capability
from public.roles r
cross join (
  values
    ('profile.password.update'),
    ('profile.email.update')
) as c(capability)
where r.slug in ('user', 'admin')
on conflict (role_id, capability) do nothing;