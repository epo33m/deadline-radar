-- Scheduler end-to-end (DB) state machine regression test.
--
-- Replicates the scheduler's write patterns exactly (see run-evaluate.ts):
--   create    -> INSERT ... ON CONFLICT DO NOTHING on (threshold_id, days_before, channel)
--                unique constraint; loser of a concurrent race is a no-op (0 rows).
--   retry     -> UPDATE ... SET status='pending', retry_count = retry_count + 1
--                WHERE id = ? AND status = 'failed' AND retry_count < MAX_EMAIL_DELIVERY_RETRIES
--                (MAX=3); a stale act on a retry-capped row matches 0 rows, so the
--                terminal `failed` state is preserved and only one run delivers each retry.
--
-- Runs as postgres, which is a member of service_role (the scheduler's writer role),
-- so the read_at-only guard is bypassed exactly as in production.
-- Run in a transaction and rollback at the end.

begin;

-- ---------------------------------------------------------------------------
-- 1. Fixture (auto-provisioned profile + course + task + default thresholds)
-- ---------------------------------------------------------------------------
do $fixture$
declare
  v_uid uuid;
  v_course uuid;
  v_task uuid;
begin
  insert into auth.users (id, email)
  values (gen_random_uuid(), 'scheduler-fixture@example.invalid')
  returning id into v_uid;

  if (select count(*) from public.profiles where id = v_uid) <> 1 then
    raise exception 'SCHEDULER FIXTURE FAILED: profile was not auto-provisioned';
  end if;

  insert into public.courses (user_id, name)
  values (v_uid, 'Scheduler fixture course')
  returning id into v_course;

  insert into public.tasks (user_id, course_id, title, deadline)
  values (v_uid, v_course, 'Scheduler fixture task', now() + interval '4 days')
  returning id into v_task;

  if (select count(*) from public.reminder_thresholds where task_id = v_task) < 1 then
    raise exception 'SCHEDULER FIXTURE FAILED: default reminder thresholds were not generated';
  end if;
end $fixture$;

select id from public.profiles where email = 'scheduler-fixture@example.invalid' \gset

-- ---------------------------------------------------------------------------
-- 2. Unique create-arbitration: concurrent duplicate creates collapse to 1 row
-- ---------------------------------------------------------------------------
do $$
declare
  v_delivery uuid;
  v_rt uuid;
  v_db int;
  v_claim int;
  v_count int;
  v_status text;
  v_sent_at timestamptz;
begin
  select rt.id, rt.days_before
    into v_rt, v_db
  from public.reminder_thresholds rt
  join public.tasks t on t.id = rt.task_id
  join public.profiles p on p.id = t.user_id and p.email = 'scheduler-fixture@example.invalid'
  order by rt.days_before
  limit 1;

  if v_rt is null then
    raise exception 'SCHEDULER ASSERTION FAILED: no threshold row for fixture task';
  end if;

  -- First create: email -> pending
  insert into public.notification_deliveries
    (task_id, threshold_id, channel, status, retry_count, days_before)
  select t.id, v_rt, 'email', 'pending', 0, v_db
  from public.tasks t
  join public.profiles p on p.id = t.user_id and p.email = 'scheduler-fixture@example.invalid'
  on conflict (threshold_id, days_before, channel) do nothing
  returning id into v_delivery;

  if v_delivery is null then
    raise exception 'SCHEDULER ASSERTION FAILED: first create returned no row';
  end if;

  -- Concurrent duplicate create on the same (threshold, days_before, channel): loser is a no-op
  insert into public.notification_deliveries
    (task_id, threshold_id, channel, status, retry_count, days_before)
  select t.id, v_rt, 'email', 'pending', 0, v_db
  from public.tasks t
  join public.profiles p on p.id = t.user_id and p.email = 'scheduler-fixture@example.invalid'
  on conflict (threshold_id, days_before, channel) do nothing
  returning id into v_delivery;

  if v_delivery is not null then
    raise exception 'SCHEDULER ASSERTION FAILED: duplicate create unexpectedly won the race';
  end if;

  select count(*) into v_count
  from public.notification_deliveries
  where threshold_id = v_rt and days_before = v_db and channel = 'email';
  if v_count <> 1 then
    raise exception 'SCHEDULER ASSERTION FAILED: expected exactly 1 email delivery, found %', v_count;
  end if;
  raise notice 'PASS  A. duplicate create arbitrated by unique (threshold_id, days_before, channel) -> 1 row';

  -- Different channel on the same (threshold, days_before) is a distinct delivery
  insert into public.notification_deliveries
    (task_id, threshold_id, channel, status, retry_count, days_before, sent_at)
  select t.id, v_rt, 'in_app', 'sent', 0, v_db, now()
  from public.tasks t
  join public.profiles p on p.id = t.user_id and p.email = 'scheduler-fixture@example.invalid'
  on conflict (threshold_id, days_before, channel) do nothing
  returning id into v_delivery;

  if v_delivery is null then
    raise exception 'SCHEDULER ASSERTION FAILED: in_app create unexpectedly lost to email row';
  end if;
  raise notice 'PASS  B. email and in_app deliveries coexist on same (threshold, days_before)';

  -- ---------------------------------------------------------------------------
  -- 3. Atomic retry-claim with cap: claim at retry_count < 3 wins, at cap = no-op
  -- ---------------------------------------------------------------------------
  -- Simulate deliverable failure returned by the mail provider
  update public.notification_deliveries set status = 'failed'
  where threshold_id = v_rt and days_before = v_db and channel = 'email';

  get diagnostics v_claim = row_count;
  if v_claim <> 1 then
    raise exception 'SCHEDULER ASSERTION FAILED: failed transition targeted wrong rows (%)', v_claim;
  end if;

  -- Claim 1: failed + retry_count 0 < 3 -> pending, retry_count 1
  update public.notification_deliveries
     set status = 'pending', retry_count = retry_count + 1
   where threshold_id = v_rt and days_before = v_db and channel = 'email'
     and status = 'failed'
     and retry_count < 3
  returning id into v_delivery;
  get diagnostics v_claim = row_count;
  if v_claim <> 1 then
    raise exception 'SCHEDULER ASSERTION FAILED: claim 1 expected 1 row, got %', v_claim;
  end if;

  -- Claim 2 and 3 reach the cap of 3
  update public.notification_deliveries set status = 'failed'
  where threshold_id = v_rt and days_before = v_db and channel = 'email';
  update public.notification_deliveries
     set status = 'pending', retry_count = retry_count + 1
   where threshold_id = v_rt and days_before = v_db and channel = 'email'
     and status = 'failed'
     and retry_count < 3;
  get diagnostics v_claim = row_count;
  if v_claim <> 1 then
    raise exception 'SCHEDULER ASSERTION FAILED: claim 2 expected 1 row, got %', v_claim;
  end if;

  update public.notification_deliveries set status = 'failed'
  where threshold_id = v_rt and days_before = v_db and channel = 'email';
  update public.notification_deliveries
     set status = 'pending', retry_count = retry_count + 1
   where threshold_id = v_rt and days_before = v_db and channel = 'email'
     and status = 'failed'
     and retry_count < 3;
  get diagnostics v_claim = row_count;
  if v_claim <> 1 then
    raise exception 'SCHEDULER ASSERTION FAILED: claim 3 expected 1 row, got %', v_claim;
  end if;

  -- Claim 4 at the cap: 0 rows -> terminal failed preserved, no more sends
  update public.notification_deliveries set status = 'failed'
  where threshold_id = v_rt and days_before = v_db and channel = 'email';
  update public.notification_deliveries
     set status = 'pending', retry_count = retry_count + 1
   where threshold_id = v_rt and days_before = v_db and channel = 'email'
     and status = 'failed'
     and retry_count < 3
  returning id into v_delivery;
  get diagnostics v_claim = row_count;
  if v_claim <> 0 then
    raise exception 'SCHEDULER ASSERTION FAILED: claim at cap expected 0 rows, got %', v_claim;
  end if;
  if v_delivery is not null then
    raise exception 'SCHEDULER ASSERTION FAILED: cap-limited claim still returned a row';
  end if;

  select status, retry_count into v_status, v_claim
  from public.notification_deliveries
  where threshold_id = v_rt and days_before = v_db and channel = 'email';
  if v_status <> 'failed' or v_claim <> 3 then
    raise exception 'SCHEDULER ASSERTION FAILED: terminal state not preserved (status=%, retry_count=%)', v_status, v_claim;
  end if;
  raise notice 'PASS  C. atomic retry claim: rows claimed 1,1,1 then 0 at cap; terminal failed with retry_count 3 preserved';

  -- ---------------------------------------------------------------------------
  -- 4. Trivial pending -> sent with sent_at (scheduler path is ungated)
  -- ---------------------------------------------------------------------------
  update public.notification_deliveries
     set status = 'pending', retry_count = 0
   where threshold_id = v_rt and days_before = v_db and channel = 'email';
  update public.notification_deliveries
     set status = 'sent', sent_at = clock_timestamp()
   where threshold_id = v_rt and days_before = v_db and channel = 'email'
     and status = 'pending';
  select status, sent_at, retry_count into v_status, v_sent_at, v_count
  from public.notification_deliveries
  where threshold_id = v_rt and days_before = v_db and channel = 'email';
  if v_status <> 'sent' or v_sent_at is null or v_count <> 0 then
    raise exception 'SCHEDULER ASSERTION FAILED: pending -> sent path broken (status=%, sent_at=%, retry_count=%)', v_status, v_sent_at, v_count;
  end if;
  raise notice 'PASS  D. pending -> sent with sent_at populated and retry_count reset';
end $$;

rollback;