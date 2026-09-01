-- Issue #8: attachments table + private storage bucket, owner RLS via tasks join.
-- Apply in Supabase SQL Editor (or via supabase db push when CLI is wired).
-- Path convention: attachments/{user_id}/{task_id}/{filename} (bucket = attachments).

do $$ begin
  create type public.attachment_type as enum ('file', 'link');
exception
  when duplicate_object then null;
end $$;

create table if not exists public.attachments (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references public.tasks (id) on delete cascade,
  type public.attachment_type not null,
  name text not null check (char_length(trim(name)) > 0),
  storage_path text,
  url text,
  created_at timestamptz not null default now(),
  constraint attachment_source_check check (
    (type = 'file' and storage_path is not null and url is null)
    or (type = 'link' and url is not null and storage_path is null)
  )
);

create index if not exists idx_attachments_task_id
  on public.attachments (task_id);

alter table public.attachments enable row level security;

drop policy if exists "attachments_all_own" on public.attachments;
drop policy if exists "attachments_select_own" on public.attachments;
drop policy if exists "attachments_insert_own" on public.attachments;
drop policy if exists "attachments_update_own" on public.attachments;
drop policy if exists "attachments_delete_own" on public.attachments;

create policy "attachments_select_own"
  on public.attachments
  for select
  using (
    task_id in (select id from public.tasks where user_id = auth.uid())
  );

create policy "attachments_insert_own"
  on public.attachments
  for insert
  with check (
    task_id in (select id from public.tasks where user_id = auth.uid())
  );

create policy "attachments_update_own"
  on public.attachments
  for update
  using (
    task_id in (select id from public.tasks where user_id = auth.uid())
  )
  with check (
    task_id in (select id from public.tasks where user_id = auth.uid())
  );

create policy "attachments_delete_own"
  on public.attachments
  for delete
  using (
    task_id in (select id from public.tasks where user_id = auth.uid())
  );

-- Private attachments bucket; object keys are {user_id}/{task_id}/{filename}.
insert into storage.buckets (id, name, public)
values ('attachments', 'attachments', false)
on conflict (id) do update set public = excluded.public;

drop policy if exists "attachments_storage_select_own" on storage.objects;
drop policy if exists "attachments_storage_insert_own" on storage.objects;
drop policy if exists "attachments_storage_update_own" on storage.objects;
drop policy if exists "attachments_storage_delete_own" on storage.objects;

create policy "attachments_storage_select_own"
  on storage.objects
  for select
  using (
    bucket_id = 'attachments'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy "attachments_storage_insert_own"
  on storage.objects
  for insert
  with check (
    bucket_id = 'attachments'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy "attachments_storage_update_own"
  on storage.objects
  for update
  using (
    bucket_id = 'attachments'
    and (storage.foldername(name))[1] = auth.uid()::text
  )
  with check (
    bucket_id = 'attachments'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy "attachments_storage_delete_own"
  on storage.objects
  for delete
  using (
    bucket_id = 'attachments'
    and (storage.foldername(name))[1] = auth.uid()::text
  );
