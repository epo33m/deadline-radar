-- P1 summary RPC: tz-aware bucket + progress aggregation in Postgres.
--
-- Replaces the API's unbounded full-table scan (SELECT all user tasks to
-- Node, two .map() passes with per-row Date construction) with a single
-- round trip returning 7 ints + progress. Semantics mirror
-- packages/domain/src/summary.ts (summarizeDeadlineBuckets) and
-- packages/domain/src/progress.ts (summarizeProgress) exactly:
-- - Buckets are calendar-day windows compared by YYYY-MM-DD day key in the
--   caller's timezone: thisWeek/nextWeek are 7/14-day rolling windows,
--   thisMonth a 30-day rolling window. End keys are INCLUSIVE.
-- - `done` tasks are excluded from every bucket (including allTasks).
-- - `missed` counts non-done tasks whose deadline instant is before p_now;
--   such tasks STILL count toward their calendar bucket.
-- - nextWeek excludes the thisWeek window (mirrors the JS else-if).
-- - Progress: total counts every non-deleted task; completed counts `done`;
--   on-time means done with completed_at <= deadline; courses aggregates
--   ACTIVE tasks per course, ordered by task count desc. Missing course
--   falls back to 'Uncategorized'.
--
-- Design notes:
-- - SECURITY DEFINER so RLS can never silently filter rows; tenancy is
--   enforced by the explicit p_user_id predicate. Callers MUST pass the
--   authenticated subject id, never a client-supplied value.
-- - SET search_path = public (fixed) — required hygiene for DEFINER.
-- - p_tz must be a valid IANA name; the API validates with
--   Intl.DateTimeFormat and falls back to 'UTC' before calling (Postgres
--   raises on unknown zones, same as Intl).
-- - Course color tie-break: JS keeps the first-seen color per course name;
--   SQL uses MAX(color). Identical whenever one course has one color
--   (guaranteed by the tasks->courses FK in practice); documented here.
-- - Course ordering ties (equal counts) break by name ASC for determinism;
--   JS uses stable first-seen order. Order of tied rows is not contractual.
-- - STABLE (no writes) + idempotent CREATE OR REPLACE (house style).

create or replace function public.get_user_summary(
  p_user_id uuid,
  p_tz text,
  p_now timestamptz
)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  with user_tasks as (
    select
      t.status,
      t.deadline,
      t.completed_at,
      (t.deadline at time zone p_tz)::date as day_key,
      coalesce(c.name, 'Uncategorized') as course_name,
      c.color as course_color
    from tasks t
    left join courses c
      on c.id = t.course_id
     and c.deleted_at is null
    where t.user_id = p_user_id
      and t.deleted_at is null
  ),
  keys as (
    select
      (p_now at time zone p_tz)::date as today,
      ((p_now at time zone p_tz)::date + 1) as tomorrow,
      ((p_now at time zone p_tz)::date + 7) as week_end,
      ((p_now at time zone p_tz)::date + 14) as next_end,
      ((p_now at time zone p_tz)::date + 30) as month_end
  ),
  buckets as (
    select
      count(*) filter (where ut.status <> 'done') as all_tasks,
      count(*) filter (where ut.status <> 'done' and ut.deadline < p_now) as missed,
      count(*) filter (where ut.status <> 'done' and ut.day_key = k.today) as today,
      count(*) filter (where ut.status <> 'done' and ut.day_key = k.tomorrow) as tomorrow,
      count(*) filter (where ut.status <> 'done' and ut.day_key between k.today and k.week_end) as this_week,
      count(*) filter (where ut.status <> 'done' and ut.day_key > k.week_end and ut.day_key <= k.next_end) as next_week,
      count(*) filter (where ut.status <> 'done' and ut.day_key between k.today and k.month_end) as this_month
    from user_tasks ut cross join keys k
  ),
  progress as (
    select
      count(*) filter (where status = 'done') as completed,
      count(*) as total,
      count(*) filter (
        where status = 'done'
          and completed_at is not null
          and completed_at <= deadline
      ) as on_time
    from user_tasks
  ),
  course_slices as (
    select coalesce(
      jsonb_agg(
        jsonb_build_object(
          'name', course_name,
          'color', max_color,
          'tasks', n
        )
        order by n desc, course_name asc
      ),
      '[]'::jsonb
    ) as courses
    from (
      select
        course_name,
        max(course_color) as max_color,
        count(*) as n
      from user_tasks
      where status <> 'done'
      group by course_name
    ) s
  )
  select jsonb_build_object(
    'summary', jsonb_build_object(
      'today', b.today,
      'tomorrow', b.tomorrow,
      'thisWeek', b.this_week,
      'nextWeek', b.next_week,
      'thisMonth', b.this_month,
      'missed', b.missed,
      'allTasks', b.all_tasks
    ),
    'progress', jsonb_build_object(
      'completed', p.completed,
      'total', p.total,
      'onTime', p.on_time,
      'onTimeTotal', p.completed,
      'courses', c.courses
    )
  )
  from buckets b cross join progress p cross join course_slices c;
$$;
