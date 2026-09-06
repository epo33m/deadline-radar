-- Keep public.profiles.email aligned with auth.users.email after an Auth email change.
-- Issue #38: Supabase "Confirm email change" (new address only) sends a confirmation
-- link; when the user confirms, auth.users.email updates and this trigger mirrors it.

create or replace function public.handle_user_email_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.email is distinct from old.email then
    update public.profiles
    set email = new.email
    where id = new.id;
  end if;
  return new;
end;
$$;

drop trigger if exists on_auth_user_email_changed on auth.users;
create trigger on_auth_user_email_changed
  after update of email on auth.users
  for each row execute function public.handle_user_email_change();