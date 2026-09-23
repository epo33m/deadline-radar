-- Normalize profile emails at write time (F-13).
-- All profiles.email writes flow through these two trigger functions (the
-- L-5 guard blocks direct writes), so normalizing here covers every path.
-- No backfill: the same guard would reject a mass UPDATE, and pre-existing
-- mixed-case rows are harmless (quotas are keyed by user_id, sends now
-- normalize defensively in run-evaluate.ts).

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email)
  values (new.id, lower(trim(new.email)));
  return new;
end;
$$;

create or replace function public.handle_user_email_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.email is distinct from old.email then
    -- Transaction-local trusted sync marker (discarded at COMMIT/ROLLBACK)
    perform set_config('app.in_auth_sync', 'true', true);

    update public.profiles
    set
      email = lower(trim(new.email)),
      updated_at = now()
    where id = new.id;
  end if;
  return new;
end;
$$;
