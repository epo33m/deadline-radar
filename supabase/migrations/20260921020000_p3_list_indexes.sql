-- P3 index gaps (performance-audit-2026-09-20 §P3, behind M9's good work).
-- Follows project migration conventions using idempotent
-- 'create index if not exists'.
--
-- 1. Attachments lookup by task (GET /tasks/:id files + ownedAttachment
--    join): attachments carried no index besides the PK, so task-scoped
--    lookups seq-scan at scale.
create index if not exists idx_attachments_task_id
  on public.attachments (task_id);
--
-- 2. Course-filtered task list + date window: WHERE user_id = ? AND
--    deleted_at IS NULL [AND course_id = ?] [AND deadline >= ? AND
--    deadline < ?] ORDER BY deadline ASC, id ASC. Equality + equality +
--    range on (user_id, course_id, deadline); the pre-existing
--    idx_tasks_user_deadline_id_active serves unfiltered lists.
create index if not exists idx_tasks_user_course_deadline_active
  on public.tasks (user_id, course_id, deadline asc)
  where deleted_at is null;
--
-- 3. In-app notification list (JOIN deliveries -> tasks, filter
--    tasks.user_id = ?, ORDER BY sent_at DESC, id DESC): EXPLAIN verdict
--    2026-09-21 (scratch PG, 100k tasks / 157k deliveries / 200 users):
--    the planner keeps the M9 task_id-led partial index (nested loop from
--    the user's tasks via idx_tasks_user_deadline_id_active, 480 probes,
--    top-N heapsort over ~765 rows, ~1.1ms, 1456 buffers) EVEN WITH a
--    sent_at-led candidate present (identical plan, candidate unused).
--    A sent_at-led scan would need ~10k global-recency probes to find 51
--    rows for one user — strictly worse. So NO new index here: an unused
--    index would only tax every write. Re-check on production-shape data
--    if per-user delivery volume grows 10-100x.
--    (Observed, out of scope: unread-count is a hash-join + seq scan
--    ~10ms at this scale — no ORDER BY, so no B-tree helps. If it ever
--    matters, the fix is denormalizing user_id into notification_deliveries,
--    not another index.)
