-- M-9: Composite & filtered indexes for hot query lists (tasks, courses, in-app notifications)
-- Follows project migration conventions using idempotent 'create index if not exists'.

-- 1. Tasks List Index
-- Targets: WHERE user_id = ? AND deleted_at IS NULL [AND course_id = ?] ORDER BY deadline ASC, id ASC
-- Allows forward index scan satisfying equality filter, keyset pagination, and sort order without a Sort node.
create index if not exists idx_tasks_user_deadline_id_active
  on public.tasks (user_id, deadline asc, id asc)
  where deleted_at is null;

-- 2. Courses List Index
-- Targets: WHERE user_id = ? AND deleted_at IS NULL ORDER BY created_at DESC, id DESC
-- Allows index scan in reverse creation order with deterministic tie-breaker for keyset cursor pagination.
create index if not exists idx_courses_user_created_id_active
  on public.courses (user_id, created_at desc, id desc)
  where deleted_at is null;

-- 3. In-App Notification Deliveries List Index
-- Targets: JOIN tasks ON task_id = tasks.id WHERE channel = 'in_app' AND status = 'sent' ORDER BY sent_at DESC, id DESC
-- Partial index filters only in-app sent deliveries, supporting fast task join and sent_at sorting/unread counting.
create index if not exists idx_notification_deliveries_in_app_sent
  on public.notification_deliveries (task_id, sent_at desc, id desc)
  where channel = 'in_app' and status = 'sent';
