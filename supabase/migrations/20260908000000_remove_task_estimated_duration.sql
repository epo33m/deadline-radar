-- Remove the unused estimated_duration column from tasks.
-- The field was stored and displayed only; nothing consumes it (no reminder,
-- deadline, or notification logic depends on it).

alter table public.tasks drop column if exists estimated_duration;
