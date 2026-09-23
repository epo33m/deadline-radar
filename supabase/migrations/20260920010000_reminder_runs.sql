-- Scheduler run ledger (F-04, observability only).
-- One row per reminder evaluation run: started_at at entry, finished_at +
-- counts at exit (status ok/error). Never read for skip/catch-up decisions;
-- the scheduler stays stateless. No purge (hourly runs ≈ 9k rows/year).

create table if not exists public.reminder_runs (
  id uuid primary key default gen_random_uuid(),
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  evaluated_tasks integer not null default 0,
  created integer not null default 0,
  retried integer not null default 0,
  emails_sent integer not null default 0,
  emails_failed integer not null default 0,
  emails_skipped_quota integer not null default 0,
  status text not null default 'running' check (status in ('running', 'ok', 'error')),
  error text
);

create index if not exists idx_reminder_runs_started_at
  on public.reminder_runs (started_at desc);

alter table public.reminder_runs enable row level security;

-- No client policies: only the privileged API role writes/reads via DATABASE_URL.
