-- Atomic sweep claim for stuck pending deliveries (F-10).
-- The stuck-pending sweep previously raced overlapping runs with only the
-- provider idempotency window as arbiter. Rows are now claimed with an
-- atomic conditional update to `sending` before the HTTP call; the loser
-- sees 0 rows and skips. `claimed_at` lets a later run reclaim a claim
-- orphaned by a crash (stale threshold applied in code, not here).

alter type public.notification_status add value if not exists 'sending';

alter table public.notification_deliveries
  add column if not exists claimed_at timestamptz;
