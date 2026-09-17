-- Add optional description column to courses.
-- Display-only field; existing rows get NULL.

alter table public.courses
  add column if not exists description text;