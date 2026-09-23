-- M-8: Database-level business rule integrity constraints.
-- Enforces data integrity at PostgreSQL level without mutating or assuming historical data.
-- 1. Ownership: tasks(course_id, user_id) -> courses(id, user_id) composite FK
-- 2. Status ↔ completed_at: status = 'done' <=> completed_at IS NOT NULL (Fail-fast, zero silent mutation)
-- 3. Course color: #RRGGBB hex format check
-- 4. Text lengths: tasks.title <= 255, tasks.description <= 5000,
--                  courses.name <= 255, courses.code <= 50, courses.description <= 5000
-- 5. Reminder thresholds: 0 <= days_before <= 36500

-- ---------------------------------------------------------------------------
-- 1. Tasks -> Courses composite ownership FK
-- ---------------------------------------------------------------------------
do $$
declare
  v_orphan_count int;
begin
  -- Validate no cross-owner records exist before adding FK
  select count(*) into v_orphan_count
  from public.tasks t
  left join public.courses c on t.course_id = c.id and t.user_id = c.user_id
  where c.id is null;

  if v_orphan_count > 0 then
    raise exception 'M-8 migration halted: % tasks violate course owner invariant. No historical data was modified.', v_orphan_count;
  end if;
end $$;

do $$ begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.courses'::regclass
      and conname = 'courses_id_user_id_key'
  ) then
    alter table public.courses
      add constraint courses_id_user_id_key unique (id, user_id);
  end if;
end $$;

do $$ begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.tasks'::regclass
      and conname = 'tasks_course_id_user_id_fkey'
  ) then
    alter table public.tasks
      drop constraint if exists tasks_course_id_fkey;
    alter table public.tasks
      add constraint tasks_course_id_user_id_fkey
      foreign key (course_id, user_id)
      references public.courses (id, user_id)
      on delete cascade;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 2. Tasks completed_at ↔ status invariant (Fail-fast validation)
-- ---------------------------------------------------------------------------
do $$
declare
  v_done_null_count int;
  v_nondone_filled_count int;
begin
  select count(*) into v_done_null_count
  from public.tasks
  where status = 'done' and completed_at is null;

  select count(*) into v_nondone_filled_count
  from public.tasks
  where status != 'done' and completed_at is not null;

  if v_done_null_count > 0 or v_nondone_filled_count > 0 then
    raise exception 'M-8 migration halted: dirty data detected in public.tasks (% done tasks with completed_at NULL, % non-done tasks with completed_at NOT NULL). No historical data was modified.',
      v_done_null_count, v_nondone_filled_count;
  end if;
end $$;

alter table public.tasks
  drop constraint if exists tasks_completed_at_status_check;

alter table public.tasks
  add constraint tasks_completed_at_status_check check (
    (status = 'done' and completed_at is not null) or
    (status != 'done' and completed_at is null)
  );

-- ---------------------------------------------------------------------------
-- 3. Courses color hex validation (#RRGGBB)
-- ---------------------------------------------------------------------------
do $$
declare
  v_invalid_color_count int;
begin
  select count(*) into v_invalid_color_count
  from public.courses
  where color is not null and color !~* '^#[0-9a-f]{6}$';

  if v_invalid_color_count > 0 then
    raise exception 'M-8 migration halted: % courses contain invalid color format. No historical data was modified.', v_invalid_color_count;
  end if;
end $$;

alter table public.courses
  drop constraint if exists courses_color_hex_check;

alter table public.courses
  add constraint courses_color_hex_check check (
    color is null or color ~* '^#[0-9a-f]{6}$'
  );

-- ---------------------------------------------------------------------------
-- 4. Text length limits (courses & tasks)
-- ---------------------------------------------------------------------------
do $$
declare
  v_viol_count int;
begin
  select count(*) into v_viol_count from public.courses where char_length(name) > 255;
  if v_viol_count > 0 then
    raise exception 'M-8 migration halted: % courses have name > 255 chars.', v_viol_count;
  end if;

  select count(*) into v_viol_count from public.courses where code is not null and char_length(code) > 50;
  if v_viol_count > 0 then
    raise exception 'M-8 migration halted: % courses have code > 50 chars.', v_viol_count;
  end if;

  select count(*) into v_viol_count from public.courses where description is not null and char_length(description) > 5000;
  if v_viol_count > 0 then
    raise exception 'M-8 migration halted: % courses have description > 5000 chars.', v_viol_count;
  end if;

  select count(*) into v_viol_count from public.tasks where char_length(title) > 255;
  if v_viol_count > 0 then
    raise exception 'M-8 migration halted: % tasks have title > 255 chars.', v_viol_count;
  end if;

  select count(*) into v_viol_count from public.tasks where description is not null and char_length(description) > 5000;
  if v_viol_count > 0 then
    raise exception 'M-8 migration halted: % tasks have description > 5000 chars.', v_viol_count;
  end if;
end $$;

alter table public.courses
  drop constraint if exists courses_name_length_check;

alter table public.courses
  add constraint courses_name_length_check check (
    char_length(name) <= 255
  );

alter table public.courses
  drop constraint if exists courses_code_length_check;

alter table public.courses
  add constraint courses_code_length_check check (
    code is null or char_length(code) <= 50
  );

alter table public.courses
  drop constraint if exists courses_description_length_check;

alter table public.courses
  add constraint courses_description_length_check check (
    description is null or char_length(description) <= 5000
  );

alter table public.tasks
  drop constraint if exists tasks_title_length_check;

alter table public.tasks
  add constraint tasks_title_length_check check (
    char_length(title) <= 255
  );

alter table public.tasks
  drop constraint if exists tasks_description_length_check;

alter table public.tasks
  add constraint tasks_description_length_check check (
    description is null or char_length(description) <= 5000
  );

-- ---------------------------------------------------------------------------
-- 5. Reminder thresholds days_before range check (0 <= days_before <= 36500)
-- ---------------------------------------------------------------------------
do $$
declare
  v_invalid_days_count int;
begin
  select count(*) into v_invalid_days_count
  from public.reminder_thresholds
  where days_before < 0 or days_before > 36500;

  if v_invalid_days_count > 0 then
    raise exception 'M-8 migration halted: % reminder_thresholds have days_before out of [0, 36500] range.', v_invalid_days_count;
  end if;
end $$;

alter table public.reminder_thresholds
  drop constraint if exists reminder_thresholds_days_before_check;

alter table public.reminder_thresholds
  add constraint reminder_thresholds_days_before_check check (
    days_before >= 0 and days_before <= 36500
  );
