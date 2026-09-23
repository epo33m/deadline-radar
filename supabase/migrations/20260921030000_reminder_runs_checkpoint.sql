-- RF-01: scheduler run checkpoint (resume after crashes).
-- Persists the last fully-processed task id on the reminder_runs ledger row,
-- written after each completed batch. On a mid-run failure / DB timeout the
-- operator reads last_seen_task_id from the errored row and the next run
-- resumes with the natural keyset (WHERE id > ?) — no full re-evaluation.
-- Observability only: never read for skip/catch-up logic; the scheduler
-- stays stateless (executor advances its own in-memory keyset each run).
--
-- Nullable by design: legacy + failed-start rows carry no checkpoint. No
-- index needed — the column is written a handful of times per run and
-- resumed via idx_reminder_runs_started_at, never queried by value.
alter table public.reminder_runs
  add column if not exists last_seen_task_id uuid;