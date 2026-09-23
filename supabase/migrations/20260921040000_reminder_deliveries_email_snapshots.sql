-- RF-02: deterministic email identity across scheduler runs.
--
-- The reminder email body is derived from live task fields, and the Resend
-- idempotency key is a hash of that body. Without a snapshot, editing a task
-- between a failed attempt and a later-run retry changes the body → changes
-- the key → the provider treats the retry as a brand-new email (possible
-- duplicate). Freezing the body inputs on the first send attempt keeps the
-- key stable for the whole delivery lifecycle.
--
-- email_idempotency_key stores the exact key to reuse. It is written with the
-- frozen body and only rewritten (rotated) when the provider terminally
-- rejects the key (`invalid_idempotent_request` / `invalid_idempotency_key`),
-- so a poisoned key can still deliver on the next retry.
--
-- Both nullable: legacy rows and deliveries that never reached a send carry
-- no snapshot. No index — the columns are read per-delivery by primary key,
-- never queried by value.
alter table public.notification_deliveries
  add column if not exists email_snapshot jsonb,
  add column if not exists email_idempotency_key text;
