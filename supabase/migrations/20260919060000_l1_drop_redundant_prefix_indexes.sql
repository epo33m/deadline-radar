-- L-1/FINAL CLOSURE: Drop redundant m5 prefix indexes superseded by m9 composites.
--
-- idx_tasks_user_deadline_active  on tasks  (user_id, deadline)       WHERE deleted_at IS NULL
--   superseded by idx_tasks_user_deadline_id_active (user_id, deadline, id) WHERE deleted_at IS NULL
--   (same predicate and sort; (user_id, deadline) is a strict prefix of the m9 composite)
--
-- idx_courses_user_created_active on courses (user_id, created_at)    WHERE deleted_at IS NULL
--   superseded by idx_courses_user_created_id_active (user_id, created_at, id) WHERE deleted_at IS NULL
--   (same predicate and sort; strict prefix)
--
-- Kept (still load-bearing, not covered by any composite):
--   idx_tasks_user_status_active                 -> status-filtered task lists
--   idx_notification_deliveries_status_created   -> scheduler status/created_at scans

drop index if exists public.idx_tasks_user_deadline_active;
drop index if exists public.idx_courses_user_created_active;