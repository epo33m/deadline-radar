-- Track when a task was completed so on-time completion can be measured
-- accurately (completed_at <= deadline). Existing rows: done tasks backfill
-- from updated_at, everything else gets NULL.

alter table public.tasks
  add column if not exists completed_at timestamptz;

update public.tasks
  set completed_at = updated_at
  where status = 'done' and completed_at is null;
