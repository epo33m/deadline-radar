-- L-1 index set regression test: final contract index set present, redundant
-- m5 prefix indexes absent, load-bearing legacy indexes still present.
-- Run in a transaction and rollback at the end.

begin;

do $$
declare
  redundant_tasks boolean;
  redundant_courses boolean;
  contract_tasks boolean;
  contract_courses boolean;
  contract_in_app boolean;
  contract_idempotency boolean;
  keep_status boolean;
  keep_deliveries boolean;
begin
  select exists(
    select 1 from pg_indexes
    where schemaname = 'public' and indexname = 'idx_tasks_user_deadline_active'
  ) into redundant_tasks;
  if redundant_tasks then
    raise exception 'redundant m5 index idx_tasks_user_deadline_active still exists';
  end if;

  select exists(
    select 1 from pg_indexes
    where schemaname = 'public' and indexname = 'idx_courses_user_created_active'
  ) into redundant_courses;
  if redundant_courses then
    raise exception 'redundant m5 index idx_courses_user_created_active still exists';
  end if;

  select exists(
    select 1 from pg_indexes
    where schemaname = 'public' and tablename = 'tasks'
      and indexname = 'idx_tasks_user_deadline_id_active'
  ) into contract_tasks;
  if not contract_tasks then
    raise exception 'contract index idx_tasks_user_deadline_id_active missing';
  end if;

  select exists(
    select 1 from pg_indexes
    where schemaname = 'public' and tablename = 'courses'
      and indexname = 'idx_courses_user_created_id_active'
  ) into contract_courses;
  if not contract_courses then
    raise exception 'contract index idx_courses_user_created_id_active missing';
  end if;

  select exists(
    select 1 from pg_indexes
    where schemaname = 'public' and tablename = 'notification_deliveries'
      and indexname = 'idx_notification_deliveries_in_app_sent'
  ) into contract_in_app;
  if not contract_in_app then
    raise exception 'contract index idx_notification_deliveries_in_app_sent missing';
  end if;

  select exists(
    select 1 from pg_indexes
    where schemaname = 'public' and tablename = 'idempotency_keys'
      and indexname = 'idempotency_keys_expires_at_idx'
  ) into contract_idempotency;
  if not contract_idempotency then
    raise exception 'contract index idempotency_keys_expires_at_idx missing';
  end if;

  select exists(
    select 1 from pg_indexes
    where schemaname = 'public' and tablename = 'tasks'
      and indexname = 'idx_tasks_user_status_active'
  ) into keep_status;
  if not keep_status then
    raise exception 'load-bearing index idx_tasks_user_status_active missing';
  end if;

  select exists(
    select 1 from pg_indexes
    where schemaname = 'public' and tablename = 'notification_deliveries'
      and indexname = 'idx_notification_deliveries_status_created'
  ) into keep_deliveries;
  if not keep_deliveries then
    raise exception 'load-bearing index idx_notification_deliveries_status_created missing';
  end if;
end $$;

rollback;