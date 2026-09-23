-- C-1 fix: let the reminder scheduler — a direct PostgreSQL connection via
-- DATABASE_URL (role `postgres`, which is a member of Supabase `service_role`)
-- — transition notification_deliveries state, while authenticated/anon clients
-- remain restricted to `read_at` only.
--
-- Why the original guard was insufficient: it only checked auth.role(), which
-- reads a PostgREST JWT-claim GUC. The scheduler does NOT go through PostgREST
-- (it uses Drizzle over DATABASE_URL), so auth.role() is NULL there and the
-- bypass never applied. Every status/retry_count/sent_at write therefore raised
-- 'Only read_at may be updated on notification_deliveries', leaving email
-- deliveries stuck at `pending` forever (pending -> sent, pending -> failed and
-- failed -> pending all blocked).
--
-- The added predicate keys off the role that actually executes the statement.
-- Verified in the target environment: `authenticated` and `anon` are NOT
-- members of `service_role`, so the read_at-only restriction is unchanged for
-- clients; only privileged connections gain the state transitions (which they
-- were already able to perform in every other respect).
--
-- Scope: function body only. No trigger definition, table, column, RLS policy,
-- grant, FK, or API contract is changed.
-- Idempotent: safe to re-apply (CREATE OR REPLACE FUNCTION).

create or replace function public.enforce_delivery_read_at_only()
returns trigger
language plpgsql
as $$
begin
  -- Privileged writer: PostgREST service_role JWT (original path) OR a direct
  -- privileged SQL connection (the scheduler via DATABASE_URL).
  if auth.role() = 'service_role'
     or pg_has_role(current_user, 'service_role', 'member') then
    return new;
  end if;

  -- Everyone else (authenticated / anon) may only change read_at.
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
