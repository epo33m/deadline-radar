-- RF-04: single-flight reminder runs.
--
-- The per-user per-run email budget (MAX_EMAILS_PER_USER_PER_RUN) is enforced
-- with an in-memory counter, so two overlapping runs each start from zero and
-- can together spend more than the cap for one interval. The atomic delivery
-- claims still prevent duplicate emails, but the cost blast-radius is
-- multiplied. Rather than introduce a per-user DB counter (needs a window
-- definition the app does not have), forbid overlapping runs entirely: this
-- partial unique index allows at most one row in `reminder_runs` with
-- status = 'running'.
--
-- The evaluator inserts its ledger row first; a 23505 on this index means
-- another run is active and the new run exits early without doing any work.
-- A run that crashes leaves its row `running`; the evaluator reclaims it
-- (status → 'error') once it is older than RUN_LOCK_STALE_MS, then retries
-- the insert. Reusing the ledger avoids a dedicated lock table/seed row.
create unique index if not exists reminder_runs_single_active
  on public.reminder_runs (status)
  where status = 'running';
