-- Failure context for debugging (F-05, observability only).
-- last_error + failed_at describe the most recent failed attempt and are
-- overwritten on every markFailed. No backfill: NULL means no recorded
-- failure, which is true for all pre-existing rows.

alter table public.notification_deliveries
  add column if not exists last_error text;

alter table public.notification_deliveries
  add column if not exists failed_at timestamptz;
