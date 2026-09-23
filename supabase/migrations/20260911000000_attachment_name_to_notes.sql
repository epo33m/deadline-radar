-- Replace the attachment display-name column with a free-text notes column.
-- Old custom names are destroyed (still in develop); url/storage_path/type/task_id are untouched.
-- Apply in Supabase SQL Editor (or via supabase db push when CLI is wired).

alter table public.attachments drop column if exists name;
alter table public.attachments add column if not exists notes text;
