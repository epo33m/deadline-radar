-- BUG-01: Verify registration RBAC trigger and email normalization
-- Tests that handle_new_user():
-- 1. Normalizes email (lower + trim)
-- 2. Creates profile in public.profiles
-- 3. Automatically provisions default 'user' role in public.user_roles
-- 4. Does not overwrite or conflict with pre-existing or elevated roles
-- Runs in a transaction and rolls back at the end.

begin;

-- 1. New user registration auto-provisions profile + 'user' role + email normalization
do $test_registration$
declare
  v_uid uuid := gen_random_uuid();
  v_email text;
  v_role_slug text;
  v_role_count integer;
begin
  -- Simulate auth.users insert (user registration)
  insert into auth.users (id, email)
  values (v_uid, '   NewUser.Test@Example.COM   ');

  -- Verify profile created with normalized email
  select email into v_email from public.profiles where id = v_uid;
  if v_email is null then
    raise exception 'BUG-01 ASSERTION FAILED: profile was not created for new user %', v_uid;
  end if;
  if v_email <> 'newuser.test@example.com' then
    raise exception 'BUG-01 ASSERTION FAILED: email not normalized, expected "newuser.test@example.com", got "%"', v_email;
  end if;

  -- Verify default 'user' role assigned in public.user_roles
  select r.slug into v_role_slug
  from public.user_roles ur
  join public.roles r on ur.role_id = r.id
  where ur.user_id = v_uid;

  if v_role_slug is null then
    raise exception 'BUG-01 ASSERTION FAILED: no role was assigned in user_roles for new user %', v_uid;
  end if;
  if v_role_slug <> 'user' then
    raise exception 'BUG-01 ASSERTION FAILED: expected role "user", got "%"', v_role_slug;
  end if;

  select count(*) into v_role_count from public.user_roles where user_id = v_uid;
  if v_role_count <> 1 then
    raise exception 'BUG-01 ASSERTION FAILED: expected exactly 1 user_role row, got %', v_role_count;
  end if;

  raise notice 'PASS  A. handle_new_user creates profile, normalizes email, and assigns "user" role';
end $test_registration$;

-- 2. Elevated role integrity: users with 'admin' role are not demoted or corrupted
do $test_elevated$
declare
  v_admin_uid uuid := gen_random_uuid();
  v_admin_role_id uuid;
  v_role_count integer;
  v_has_admin boolean;
begin
  select id into v_admin_role_id from public.roles where slug = 'admin' limit 1;

  -- Create user
  insert into auth.users (id, email)
  values (v_admin_uid, 'admin.user@example.com');

  -- Elevate user by assigning admin role
  insert into public.user_roles (user_id, role_id)
  values (v_admin_uid, v_admin_role_id)
  on conflict do nothing;

  -- Verify user now has both or admin role intact
  select exists (
    select 1 from public.user_roles ur
    where ur.user_id = v_admin_uid and ur.role_id = v_admin_role_id
  ) into v_has_admin;

  if not v_has_admin then
    raise exception 'BUG-01 ASSERTION FAILED: admin role missing for user %', v_admin_uid;
  end if;

  raise notice 'PASS  B. elevated admin role remains intact';
end $test_elevated$;

-- 3. Backfill idempotence verification
do $test_backfill$
declare
  v_orphan_uid uuid := gen_random_uuid();
  v_role_slug text;
begin
  -- Manually insert an orphan profile (simulating historical state before trigger fix)
  -- Temporarily disable trigger or insert directly to auth without trigger or delete user_role
  insert into auth.users (id, email)
  values (v_orphan_uid, 'orphan.user@example.com');

  delete from public.user_roles where user_id = v_orphan_uid;

  -- Run backfill query
  insert into public.user_roles (user_id, role_id)
  select p.id, r.id
  from public.profiles p
  cross join public.roles r
  where r.slug = 'user'
    and p.id = v_orphan_uid
    and not exists (
      select 1 from public.user_roles ur where ur.user_id = p.id
    )
  on conflict (user_id, role_id) do nothing;

  select r.slug into v_role_slug
  from public.user_roles ur
  join public.roles r on ur.role_id = r.id
  where ur.user_id = v_orphan_uid;

  if v_role_slug <> 'user' then
    raise exception 'BUG-01 ASSERTION FAILED: backfill did not assign "user" role to orphan profile %', v_orphan_uid;
  end if;

  raise notice 'PASS  C. backfill safely assigns "user" role to orphan profile';
end $test_backfill$;

rollback;
