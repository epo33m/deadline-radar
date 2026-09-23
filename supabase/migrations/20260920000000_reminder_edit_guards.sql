-- F-01: track when a deadline / threshold offset last changed so the
-- scheduler can skip thresholds whose new trigger was already past at edit
-- time (DOMAIN.md §4), instead of only guarding on task creation time.
-- Existing rows backfill from created_at to preserve current behavior; only
-- edits after this migration get the stricter guard.

alter table public.tasks
  add column if not exists deadline_updated_at timestamptz not null default now();

-- Existing rows: no deadline edit is known, so anchor to creation time to
-- preserve the current (creation-only guard) behavior.
update public.tasks
  set deadline_updated_at = created_at;

alter table public.reminder_thresholds
  add column if not exists updated_at timestamptz not null default now();

update public.reminder_thresholds
  set updated_at = created_at;
