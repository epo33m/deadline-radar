-- Auth audit trail for security-sensitive authentication events.
-- Append-only from the API (service DB role). No secrets in payloads.
-- user_id is soft-linked (no FK) so audit inserts never block auth flows.

create table if not exists public.auth_audit_events (
  id uuid primary key default gen_random_uuid(),
  event text not null,
  user_id uuid,
  session_id text,
  result text not null check (result in ('success', 'failure', 'denied')),
  method text,
  ip text,
  user_agent text,
  request_id text,
  metadata jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_auth_audit_events_created_at
  on public.auth_audit_events (created_at desc);

create index if not exists idx_auth_audit_events_user_id
  on public.auth_audit_events (user_id)
  where user_id is not null;

create index if not exists idx_auth_audit_events_event
  on public.auth_audit_events (event);

alter table public.auth_audit_events enable row level security;

-- No client policies: only the privileged API role writes/reads via DATABASE_URL.
