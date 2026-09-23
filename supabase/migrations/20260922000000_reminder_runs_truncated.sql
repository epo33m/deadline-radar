-- RF-12: bounded-run truncation marker.
-- A run that hits MAX_TASKS_PER_RUN or MAX_RUN_DURATION_MS finishes cleanly
-- (status stays `ok`, finished_at set) and records truncated = true instead
-- of dying mid-batch. The next scheduler run re-scans from the head; already
-- sent/pending deliveries suppress resends via (task, offset, channel)
-- identity, so nothing is sent twice and no task is skipped permanently.
-- Default false keeps legacy and short runs indistinguishable-simple.
alter table public.reminder_runs
  add column if not exists truncated boolean not null default false;