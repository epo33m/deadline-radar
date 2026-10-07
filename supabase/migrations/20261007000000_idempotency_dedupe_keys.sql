-- Issue #137: idempotency completion is a best-effort write outside the
-- business-mutation transaction, so a persistently failing completion (or a
-- crash between commit and completion) lets a stale-reclaim re-execution
-- duplicate the task/course/attachment under one idempotency key. These
-- nullable dedupe columns copy the request's Idempotency-Key into the
-- business row; the partial unique indexes turn the duplicate insert into a
-- conflict the route replays instead. Existing rows stay NULL and are
-- unaffected (NULLs never conflict in a unique index).
alter table public.courses
  add column if not exists idempotency_key text;

alter table public.tasks
  add column if not exists idempotency_key text;

alter table public.reminder_thresholds
  add column if not exists idempotency_key text;

alter table public.attachments
  add column if not exists idempotency_key text;

create unique index if not exists courses_user_idempotency_key
  on public.courses (user_id, idempotency_key)
  where idempotency_key is not null;

create unique index if not exists tasks_user_idempotency_key
  on public.tasks (user_id, idempotency_key)
  where idempotency_key is not null;

create unique index if not exists reminder_thresholds_task_idempotency_key
  on public.reminder_thresholds (task_id, idempotency_key)
  where idempotency_key is not null;

create unique index if not exists attachments_task_idempotency_key
  on public.attachments (task_id, idempotency_key)
  where idempotency_key is not null;
