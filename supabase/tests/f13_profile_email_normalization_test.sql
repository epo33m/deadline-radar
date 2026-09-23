-- F-13: profile emails are normalized (lowercase + trim) at write time.
-- All profiles.email writes flow through handle_new_user (provisioning) and
-- handle_user_email_change (sync); the L-5 guard blocks direct writes.
-- Runs in a transaction and rolls back at the end.

begin;

-- 1. Provisioning normalizes a mixed-case signup email.
do $provision$
declare
  v_uid uuid;
  v_email text;
begin
  insert into auth.users (id, email)
  values (gen_random_uuid(), 'Mixed.Case.User@Example.COM')
  returning id into v_uid;

  select email into v_email from public.profiles where id = v_uid;
  if v_email <> 'mixed.case.user@example.com' then
    raise exception 'F-13 ASSERTION FAILED: provisioned email not normalized, got %', v_email;
  end if;
  raise notice 'PASS  A. handle_new_user stores lower(trim(email))';
end $provision$;

-- 2. Email-change sync normalizes as well (marker + immutability guard intact).
do $sync$
declare
  v_uid uuid;
  v_email text;
begin
  select id into v_uid
  from public.profiles
  where email = 'mixed.case.user@example.com';

  update auth.users
  set email = '  New.Address@Example.ORG  '
  where id = v_uid;

  select email into v_email from public.profiles where id = v_uid;
  if v_email <> 'new.address@example.org' then
    raise exception 'F-13 ASSERTION FAILED: synced email not normalized, got %', v_email;
  end if;
  raise notice 'PASS  B. handle_user_email_change stores lower(trim(email))';
end $sync$;

rollback;
