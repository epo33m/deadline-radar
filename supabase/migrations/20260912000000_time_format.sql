-- Time format preference: per-user display preference (24h vs 12h).
-- Backward-compatible: NOT NULL + DEFAULT backfills existing rows.
-- Presentation-only: never changes stored timestamps or timezones.

do $$ begin
  create type public.time_format as enum ('24h', '12h');
exception
  when duplicate_object then null;
end $$;

alter table public.profiles
  add column if not exists time_format public.time_format not null default '24h';
