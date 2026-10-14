# Production Environment Checklist — Deadline Radar

> Filled in by a human (owner) BEFORE the first deploy. Values never enter the repo.
> Initial status: mostly NOT DONE (prod not deployed yet).
> Recorded decisions: single replica · `AUTH_AUDIT_RETENTION_DAYS=90` ·
> Redis required (SEC-007, boot fails without it).
> Per-platform fill guide (Railway = ENV-API, Vercel = ENV-WEB) + deploy order:
> `docs/DEPLOY-PROD.md`.

Location legend:
- **ENV-API** — API service environment variables (API hosting)
- **ENV-WEB** — Web/Next.js service environment variables (Web hosting)
- **DASH-SB** — Supabase dashboard (production project)
- **DASH-RE** — Resend dashboard
- **DASH-SE** — Sentry dashboard (after the project is created)

## 1. Required boot secrets (API fails to start without them)

| Var | Fill location | Status | Notes |
|---|---|---|---|
| `DATABASE_URL` | ENV-API | ☐ | Prod Supabase pooler (`pgbouncer`, `prepare:false` stays in code) |
| `SUPABASE_URL` | ENV-API | ☐ | Prod project URL |
| `SUPABASE_ANON_KEY` | ENV-API | ☐ | Prod project anon key |
| `SUPABASE_SERVICE_ROLE_KEY` | ENV-API | ☐ | Prod project service_role; NEVER to Web |
| `CRON_SECRET` | ENV-API + scheduler cron | ☐ | Long random; the scheduler calls `GET /api/v1/cron/evaluate-reminders` with `Authorization: Bearer …` |
| `AUTH_BRIDGE_SECRET` | ENV-API **and** ENV-WEB (same) | ☐ | Long random; never the literal `"1"` |
| `REDIS_URL` | ENV-API | ☐ | Required in prod (SEC-007). Legacy TCP — used only when REST is unset |
| `UPSTASH_REDIS_REST_URL` / `UPSTASH_REDIS_REST_TOKEN` | ENV-API | ☐ | Primary transport (HTTP, no connection management). REST wins over `REDIS_URL` so accounting never split-brains. Region **US East** |
| `REDIS_TIMEOUT_MS` | ENV-API | ☐ | Optional: one Redis round-trip bound (ms). Empty = **250**. Slow/beyond this = memory-bucket fallback + warn (not 500); also the per-command bound in transports (ioredis `commandTimeout`/`connectTimeout`, Upstash REST abort signal) for rate-limit and login throttle; co-locate the Upstash region with the API region so it rarely fires |
| `BOOTSTRAP_CACHE_TTL_MS` | ENV-API | ☐ | Optional: `GET /api/v1/bootstrap` per-user cache TTL (ms). Empty = **30000**. `0` = off. Auto-evicted on every 2xx mutation (global hook); over-evict only wastes a refetch |

## 2. Functional (degraded when empty)

| Var | Fill location | Status | Notes |
|---|---|---|---|
| `RESEND_API_KEY` | ENV-API | ☐ | **REQUIRED in prod (RF-13 fail-closed): API refuses to boot when empty / not `re_` format.** Without it every delivery fails at send time (blackout) |
| `RESEND_FROM_EMAIL` | ENV-API | ☐ | **REQUIRED in prod (RF-13): valid (not the default sandbox).** Empty/invalid = boot refusal; use a DASH-RE verified domain (`resend.dev` domain = warn, preview only) |
| `SENTRY_DSN` | ENV-API **and** ENV-WEB | ☐ | Sentry project DSN (not a secret, but still via env); see §5 |
| `WEB_ORIGIN` | ENV-API + ENV-WEB | ☐ | Prod web public origin = `https://dr.rapm.space` (metadata base, cookies/CORS/redirects). **REQUIRED for the auth bridge (#162):** login/register/refresh refuse to mint cookies when empty |
| `API_ORIGIN` / `API_PORT` | ENV-WEB / ENV-API | ☐ | The API address the Web rewrites to |
| `AUTH_AUDIT_RETENTION_DAYS` | ENV-API | ☐ | Decided **90**; template active at 90 |
| `REMINDER_CUTOFF_ISO` | ENV-API | ☐ | F-03 + sign-off N-2: MUST be filled with the scheduler activation instant at deploy (ISO format) + communicated to users. **REQUIRED in production (RF-11 fail-closed): API refuses to boot when empty/malformed.** Empty = the first run WILL burst (capped by the 50/run/user quota — dozens of emails per user, not zero). Chosen value: `2026-09-26T04:07:00Z` (scheduler activation 2026-09-26; raise if the first run is much later, never lower) |
| `MAX_TASKS_PER_RUN` | ENV-API | ☐ | RF-12 optional: per-run task cap. Empty = **10000**; invalid = ignored (warning) + default, no boot failure. Set smaller when the host timeout is under the default budget |
| `MAX_RUN_DURATION_MS` | ENV-API | ☐ | RF-12 optional: per-run wall-clock deadline (ms). Empty = **120000**; invalid = ignored (warning) + default. Always < 30 min (clamped) so it never wedges the single-flight lock; align with the host `timeout`/`maxDuration` once hosting is decided |
| `REMINDER_RUN_INTERVAL_MS` | ENV-API | ☐ | RF-14 optional: scheduler run interval (ms). Empty = **3600000** (1 hour). Used by `/health/cron`: the scheduler is unhealthy when > 2× interval passed since the last `ok` run |
| `NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_ANON_KEY` | ENV-WEB | ☐ | Proxy JWT-verification fallback |
| `SUPABASE_JWT_SECRET` | ENV-API + ENV-WEB | ☐ | Optional; only for legacy HS256 Supabase projects (new ES256 via JWKS automatic) |
| `TRUST_PROXY` / `TRUSTED_PROXIES` | ENV-API | ☐ | **REQUIRED** when the web tier sits behind an edge (#160): without both, the API cannot tell callers apart from the tier, so the 20/min auth budget becomes one shared bucket for all users (wrong values = rate-limit IP spoofing **and auth-audit IPs**; without it the audit records NULL). Fill `TRUSTED_PROXIES` with the web tier egress addresses |
| `WEB_FORWARD_CLIENT_IP` | ENV-WEB | ☐ | **Optional, default OFF** (#160). Set `true` ONLY after confirming the edge platform **OVERWRITES** `X-Forwarded-For`. If the edge APPENDS the client-sent header, the API will trust an attacker-chosen entry — the attacker's bucket, worse than the shared bucket it fixes. Also needs `TRUST_PROXY=true` + `TRUSTED_PROXIES` on the API, otherwise the header is ignored. Note: with K web-tier egress addresses the limit becomes 20*K/min — keep K small |

## 3. Supabase dashboard (DASH-SB, prod project)

| Item | Status | How to verify |
|---|---|---|
| `supabase/migrations/*` applied (`bun run db:migrate`, then `db:verify`) | ☐ | `supabase/verify-prod.sql` section 5: zero pending. Sign-off N-4 (blocking): migrate MUST run BEFORE code deploy — without the `sending` enum value + `claimed_at` column, the F-10 sweep claim throws and every run 500s repeatedly |
| `db:drift` clean except the known deviation | ☐ | Expected: ONLY `profiles_id_fkey → users` (pre-existing). Anything else = migrations not applied |
| F-13 trigger function bodies normalized in prod | ☐ | The drift check does not hash function bodies — verify manually: `pg_get_functiondef` for `handle_new_user` + `handle_user_email_change` must contain `lower(trim` |
| RLS on 12 tables + 17 policies per contract | ☐ | `supabase/verify-prod.sql` sections 1–2 |
| `attachments` bucket private (`public=false`) + 4 storage policies | ☐ | `supabase/verify-prod.sql` section 3 |
| Auth → redirect allowlist ONLY prod domains | ☐ | Manual check; fill in: … |
| Auth → mandatory email confirmation, password policy & OTP expiry | ☐ | Manual check; fill in: … |
| Auth → no unknown custom hooks/webhooks | ☐ | Manual check |

## 4. Resend dashboard (DASH-RE)

| Item | Status | Notes |
|---|---|---|
| Sender domain verified (SPF/DKIM/DMARC) | ☐ | Without this, mail lands in spam / is rejected |
| No bounce/complaint webhook needed on our side | ☐ | Decided N/A: Resend's automatic suppression list already handles it; no webhook endpoint in the repo (audit item 6 result) |
| Monthly cost/quota alerting on | ☐ | Required post-SEC-003 (code quotas exist, the bill still needs an alarm) |

## 5. Sentry dashboard (DASH-SE)

| Item | Status | Notes |
|---|---|---|
| `deadline-radar-web` + `deadline-radar-api` projects created | ☑ (2026-09-27, API) | `sentry.io/epo33m`: `deadline-radar-web` (javascript-nextjs), `deadline-radar-api` (node); the `javascript-nextjs` template is unused |
| `SENTRY_DSN` | ENV-API **and** ENV-WEB | ☑ (2026-09-27, sync) | Except: `SENTRY_DSN` was once missing from the `WEB_KEYS` sync (server/edge web would never activate) — fixed. `NEXT_PUBLIC_SENTRY_DSN` for the client |
| `sendDefaultPii: false` + `beforeSend` scrub on (already in code) | ☑ | Verified by the scrub test |
| Error-rate + failed-cron alerts on | ☑ proven firing (2026-09-27) | Drill: blackout message → automatic GH issue #53; 12 events/hour → `api-error-rate` detector fires + metric issue #5 → GH issue #54. GH drills #52/#53/#54 closed. **Decision: the blackout rule is DELIBERATELY broad** (fires for every new issue — no message-contains filter in this org's builder UI; verified via API schema + CLI 3.8.0 with no `alert` subcommand). For this MVP's error volume (only 5xx captured) every new issue genuinely deserves a GH issue. Revisit if noise > ~5 issues/week: the option then = `kind=blackout` tag from code + tagged-event filter. Sentry drill issues left open (API rejects manual resolve); clearly labeled DRILL |

## 6. Pre-release repo hygiene

| Item | Status |
|---|---|
| `.env.local` / `.env*` not committed (`git status` free of secrets) | ☐ |
| No `.env*` file in `apps/web/` (Next auto-loads it in dev/build/start, so its content enters the web `process.env` unasked — #71) | ☑ (2026-09-30: `apps/web/.env.local` holding `VERCEL_OIDC_TOKEN` deleted; `apps/e2e/app-env.ts` refuses to run if it returns) |
| Release from a clean PR/diff containing ONLY audit fixes | ☐ | Sign-off: the current working tree mixes parallel feature work (UI, account security) — release from a diff holding only verified fixes, not the whole working tree |
| No SQL dumps / backups in the repo or on static hosting | ☐ |
| Prod source maps not arbitrarily exposed (or disabled if needed) | ☐ |
| `openapi.json` + `schema.d.ts` regenerated post-SEC-008 | ☑ (this session: `TaskWithCourse` without `description` confirmed in both) |
| `/.well-known/security.txt` deployed (file exists in `apps/web/public/`) | ☐ | Hosting must include the `public/` directory (default on Vercel; Docker must `COPY apps/web/public/`). Contact still a placeholder — replace before release |

## 7. Production security gates (blocking — from SECURITY_SIGNOFF_2026-09-20.md)

```
[x] C1 — Independent verification
[ ] C2 — Commit + tag
[ ] C3 — Production env + migrations + verify-prod.sql
[x] C4 — SEC-003 direct PostgREST quota bypass     ← CLOSED 2026-09-20 (owner epo33m, review 2026-12-20; prod re-run at C3 deploy)
[ ] C5 — Dashboard + security.txt
[ ] C6 — Post-deploy runtime evidence
```

### C4 — SEC-003: Direct PostgREST/Supabase INSERT quota bypass — CLOSED (code control verified 2026-09-20)

- **Risk:** the application-level quota is already enforced (200 tasks / 10 thresholds /
  50-email-per-user-per-run cap), but a direct PostgREST insert through the public
  anon key could still create tasks without the same per-user quota enforcement.
  The RLS `WITH CHECK (user_id = auth.uid())` does not limit row counts, and
  the `on_task_created` trigger injects 4 default thresholds on inserts
  from any path.
- **Subjective status forbidden:** SEC-003 must not be marked PASS/VERIFIED-FIXED
  just because the app tests are green. Status stays PARTIALLY-FIXED until this gate passes.
- **Required before release:** verify that the task quota cannot be bypassed
  through the direct Supabase/PostgREST write path.
- **Verification must cover:**
  1. application API write path (done: `tasks.quota.test.ts`, 4 tests)
  2. direct PostgREST write path using a matching anon/authenticated client
  3. RLS `WITH CHECK (user_id = auth.uid())` (existence + absence of a count bound)
  4. quota enforcement / global threshold behavior (the 50/user/run cap still throttles the rate)
  5. regression test proving the bypass fails (the N+1 direct insert is rejected
     or an equivalent compensating control, e.g. INSERT revoke / DB quota trigger)
- **Evidence required:** test output + production verification evidence
  (`supabase/verify-prod.sql` §2/§5 output + direct-write test evidence as a user).
- **Release rule:** C4 is checked only when the residual direct-write path is
  **closed** (evidence above) or an **equivalent compensating control** is documented
  and verified. Until then public release is forbidden.
- **Closure 2026-09-20 (owner: epo33m, review: 2026-12-20):** an equivalent
  compensating control closed and verified — the `task_quota_before_insert` trigger
  (200 active tasks/user) + `threshold_quota_before_insert` (10/task) in
  `supabase/migrations/20260921000000_sec003_task_threshold_quota.sql`
  (`service_role` bypass intentional & scoped); direct `notification_deliveries`
  fabrication still RLS-rejected (42501), so the email amplification path is closed.
  Evidence: fresh-DB `supabase migration up` (34/34 applied) + `migrate.ts status/verify`
  + 9/9 SQL scripts PASS (`rls_matrix.sql` 13/13 sections, `sec003_quota.sql` 9/9:
  201st task `TASK_QUOTA_EXCEEDED`, 11th threshold `THRESHOLD_QUOTA_EXCEEDED`,
  cross-tenant/anon 42501, scoped service_role bypass, deliveries 42501) + bun
  wrappers `sec003-quota.test.ts` / `rls-matrix.test.ts` PASS (negative control:
  dropping the trigger makes `sec003_quota.sql` FAIL) + full `bun run test`
  green (5 projects) + `typecheck`/`lint`/`build` green. Item (2) direct-PostgREST
  write path proven via `authenticated`/`anon` role probes (not a real anon key,
  since no Supabase project exists in this loop); direct-write evidence
  as a prod user + `verify-prod.sql` §2/§5 must be repeated at C3 deploy.

## 8. Deferred pre-release verification (from the 2026-09-20 reminder sign-off audit)

Mandatory scenarios not yet executed — execute or formally accept before release.
Reference: `docs/audits/reminder-system-audit-2026-09-20.md` §4 scenario table.

| Scenario | Status | Needed |
|---|---|---|
| S-02 parallel multi-process cron (≥2 instances, ≥10 iterations) | ☐ | Staging with 2 replicas / 2 concurrent processes against the same DB; expect: exactly 1 email per reminder per iteration |
| S-04 timeout-but-delivered | ☐ | Stateful fake provider (records delivered, then throws timeout); expect: no second email, stable key across attempts |
| S-08 cron dead 5 cycles then alive | ☐ | Kill the scheduler for 5 intervals on staging, restart; expect: controlled catch-up (cutoff active), not a burst |
| S-10 two extreme users (UTC+14 / UTC-11) | ☐ | Two-profile fixture; expect: reminders at each correct local time |
| S-11 DST transition day (forward + back) | ☐ | DST-zone fixture across the transition; expect: no shift/loss/duplication |
| S-15 dry-run first deploy on historical data | ☐ | Snapshot/mock of reasonably sized prod data, evaluator dry-run; report email counts before anything is sent |
| S-18 peak load | ☐ | Peak-equivalent candidate volume; expect: finishes far under the cron interval, indexed queries, stable memory |

## 9. Accepted risks (final verification 2026-09-20)

The following risks are formally accepted with owner and review date. Apart from
this list, no risk is accepted — the rest must be closed.

| ID | Risk | Owner | Rationale | Review | Compensating control |
|---|---|---|---|---|---|
| F-7 | 3 E2E journeys not locked in CI (advisory) | epo33m | CI `verify` only has vanilla PostgreSQL; E2E needs Chromium + prod build + live Supabase project | 2026-12-20 | `E2E_TARGET=staging bun run test:e2e` manual pre-release (`apps/e2e/README.md`); the suite refuses to run without a named target and refuses production hosts (#56); drill to green once |
| Quota-race | Two concurrent txns at 199/200 can both pass | epo33m | Accepted in the migration comment; the API stays the primary enforcement, the trigger is a backstop | 2026-12-20 | Resend cost/quota alarm (§4); active count = `deleted_at IS NULL` |
| S-02…S-18 | §8 staging scenarios not yet executed | epo33m | No staging; S-11 partly covered by unit DST vectors (6 `America/New_York` tests) | 2026-12-20 | Execute or formally accept before public release (C6) |
| P2-cache | Authz snapshot stays an in-memory Map with 30s TTL, single replica | epo33m | MVP single replica (decision above); full refetch per nav acceptable at this scale | 2026-12-20 | §11: move to Redis (`REDIS_URL`) or drop the local map BEFORE horizontal scale |
| P3-notif-idx | `sent_at`-led index for the notification list DELIBERATELY not built | epo33m | EXPLAIN gate 2026-09-21 (scratch PG 100k tasks/157k deliveries): the planner still nested-loops via M9 (~1.1ms, 1456 buffers), the candidate goes unused — an unused index only taxes writes | 2026-12-20 | Re-check via EXPLAIN if delivery volume/user rises 10–100x |
| S-no-staging | No staging environment; S-02/S-08/S-18 drills local only | epo33m | S-02 local substitute (2 processes vs same DB, ≥10 iterations); S-08/S-15/S-18 formally accepted with prod-ordering mitigations (cutoff + quota + dry-run) | 2026-12-20 | C6: post-deploy runtime evidence replaces staging drills; provide staging before the next public release if possible |

## 10. Post-deploy verification — P1 waterfall fixes (2026-09-21)

Changes: 3 task-detail selects parallelized (`apps/api/src/routes/tasks.ts`,
the `ownedTask` gate unchanged); summary aggregation moved to the Postgres RPC
(`public.get_user_summary`, migration `supabase/migrations/20260921010000_summary_rpc.sql`);
parallel cron batches + bounded sends (`apps/api/src/services/run-evaluate.ts`,
`EMAIL_SEND_CONCURRENCY=5`; the atomic claim predicate unchanged).

| Item | Status | How to verify |
|---|---|---|
| Migration `20260921010000_summary_rpc.sql` applied on staging/prod (`bun run db:migrate`, then `db:verify`) — NEW function, no backfill | ☐ | `select public.get_user_summary('<user-id>', 'UTC', now())` returns `{summary:{7 int}, progress:{…}}`; `supabase/verify-prod.sql` section 5: zero pending |
| APM spans `GET /tasks/:id`: 4 sequential → 2 (the `ownedTask` gate, then 1 parallel fan-out) | ☐ | APM trace per detail view |
| `GET /summary` response bytes + `EXPLAIN (ANALYZE, BUFFERS)` of the task scan | ☐ | Compare before/after on a heavy account; expect: index-only scan `idx_tasks_user_deadline_id_active`, payload of 7 ints + progress, not N rows |
| Cron duration + `reminder_runs` ledger before/after; no overlap with the next tick | ☐ | `[cron] evaluate-reminders finished` log (outcome+durationMs) + `reminder_runs` rows; double-sends stay 0 (atomic claim untouched) |
| Release from a clean diff holding ONLY verified fixes | ☐ | See §6: the working tree mixes parallel feature work (UI, account security) — do not release the whole working tree; no commits made in this session |

### 10b. Post-deploy verification — P2 fixes (2026-09-21)

Changes: list projection without `description` (`serializeTaskList`; the
`TaskWithCourse` contract in OpenAPI + regenerated `openapi.json`/`schema.d.ts`);
`GET /tasks?dueFrom&dueTo` + month-scoped calendar (cursor followed to exhaustion,
10-page cap); session RTT overlapped with data fetch on 6 pages
(tasks, courses, summary, calendar, task-detail, course-detail);
one `withUserRls` transaction per mutation handler (tasks PATCH/complete/thresholds,
courses PATCH, attachments link). Deliberate exceptions: POST create
(idempotency protocol), single-statement DELETE, and paths with a network call
in the middle (attachments file/delete, signed-url left as-is).

| Item | Status | How to verify |
|---|---|---|
| `GET /tasks` response bytes before/after (no `description` × N rows) | ☐ | Compare the list payload on a heavy account |
| Response row count per month nav; month correctness with >50 tasks | ☐ | Navigate the calendar on a dense month; no partial month |
| DevTools waterfall: session vs data RTT overlap | ☐ | Trace the tasks/calendar page load |
| Transaction span per mutation in APM/logs (1 tx per handler) | ☐ | Trace PATCH/PUT/complete; the ownership suite green as the pre-deploy gate |

### 10c. Post-deploy verification — P3 indexes + React hygiene (2026-09-21)

Changes: migration `supabase/migrations/20260921020000_p3_list_indexes.sql`
(`idx_attachments_task_id`, `idx_tasks_user_course_deadline_active`; both in
`schema.ts` + `schema-contract.ts` + `supabase/tests/p3_list_indexes_test.sql`
+ wrapper `packages/db/src/p3-list-indexes.test.ts`); `TaskRow` /
`CalendarDayCell` / `CalendarTaskChip` memo + `useDeferredValue` on search.
DELIBERATELY NOT built (EXPLAIN gate, data in the migration comment): the
`sent_at`-led index for notifications — the planner still picks the nested loop via M9
even with the candidate present (1.1ms, 1456 buffers @100k tasks/157k deliveries);
an unused index only taxes writes.

| Item | Status | How to verify |
|---|---|---|
| P3 migration applied (`bun run db:migrate`, `db:verify`, clean `db:drift` — the two new indexes expected, not a deviation) | ☐ | `supabase/verify-prod.sql` section 5: zero pending |
| `EXPLAIN (ANALYZE, BUFFERS)` of the three queries on prod-shaped data: attachments-by-task → Index Scan; course-filtered list → `idx_tasks_user_course_deadline_active`; notif list → M9 nested loop (re-check if delivery volume/user rises 10–100x) | ☐ | EXPLAIN output stored as evidence |
| React Profiler: search typing + month nav before/after (render counts/commit ms) | ☐ | React DevTools Profiler; `dynamic()` splits held back until Profiler data demands them |

### 10d. Post-deploy verification — RF-01 checkpoint + RF-02 email identity (2026-09-21)

Changes (migration + code; see `docs/audits/reliability-failure-modes-audit-2026-09-21.md`):

- **RF-01 — run checkpoint + confirmation-failure context + DB timeouts:**
  `supabase/migrations/20260921030000_reminder_runs_checkpoint.sql`
  (`reminder_runs.last_seen_task_id uuid`, nullable, no index). `run-evaluate.ts`
  writes `last_seen_task_id` after each finished batch (crash-safe: a failed batch
  does not move the checkpoint) and writes `last_error`/`failed_at` when a
  confirm-write fails without dropping the status to `failed`. `packages/db/src/client.ts`
  adds connection timeouts (`connect`/`statement`/`idle`/`max_lifetime`) with
  env overrides.
- **RF-02 — deterministic email identity (frozen body + key rotation):**
  `supabase/migrations/20260921040000_reminder_deliveries_email_snapshots.sql`
  (`notification_deliveries.email_snapshot jsonb` + `email_idempotency_key text`,
  nullable, no index). `apps/api/src/lib/email.ts`: `buildReminderEmailBody`
  exported; `buildReminderIdempotencyKey` takes a `nonce` (rotation);
  `isRateLimitedReminderError` — `Retry-After` now honored for
  `rate_limited`/`rate_limit_exceeded` even without `statusCode`.
  `apps/api/src/services/run-evaluate.ts`: `deliverEmail` builds the payload from
  `email_snapshot` when present (else live), uses `email_idempotency_key` when present,
  persists snapshot+key on `markSent`/`markFailed` (including the RF-01
  confirm-failure fallback), and rotates the key + persists on terminal idempotency
  errors so the next retry can deliver.
- **Schema:** `packages/db/src/schema.ts` (+`EmailDeliverySnapshot`),
  `schema-contract.ts`, `schema.test.ts`, `schema-drift.test.ts` (migration count
  37→38, latest version `20260921040000`).
- **Docs:** `docs/DOMAIN.md` §2.5 (`sent` = accepted, not delivered; frozen
  body/key) + `docs/RUNBOOK-reminders.md` §3 (tracing duplicates via
  `email_idempotency_key`).

| Item | Status | How to verify |
|---|---|---|
| Migrations `20260921030000_reminder_runs_checkpoint.sql` + `20260921040000_reminder_deliveries_email_snapshots.sql` applied (`bun run db:migrate`, then `db:verify`) — NEW nullable columns, no backfill | ☐ | `supabase/verify-prod.sql` section 5: zero pending; `db:drift` clean except `profiles_id_fkey → users` |
| RF-01 checkpoint fills: a multi-batch run writes `reminder_runs.last_seen_task_id` = the last fully processed task | ☐ | Run cron on >1 batch of data; `select id, last_seen_task_id, evaluated_tasks, status from reminder_runs order by started_at desc limit 5` |
| RF-01 mid-run crash does not move the checkpoint (failed batch → resume from the last successful batch) | ☐ | Simulate a batch failure (staging); a `status='error'` row keeps the previous batch's `last_seen_task_id` |
| RF-01 confirm-write failure: the row does NOT become `failed`, stays sendable + `last_error = 'confirm failed: …'` | ☐ | Force a confirmation-write failure (staging); check `status`, `last_error`, `failed_at` on `notification_deliveries` |
| RF-01 DB timeouts active (connect/statement/idle/max_lifetime) per prod env | ☐ | Check `SHOW statement_timeout` on the app connection; logs/observability no longer hang on a slow DB provider |
| RF-02 frozen body: after a failed send the row has `email_snapshot`; editing the task title then retrying on the next run uses the same body + key (no double email) | ☐ | `select email_snapshot, email_idempotency_key from notification_deliveries where id='<delivery-id>'`; compare the `Idempotency-Key` in the Resend dashboard across attempts |
| RF-02 key rotation: terminal idempotency rejection (`invalid_idempotent_request`/`invalid_idempotency_key`) → `email_idempotency_key` rotated + `last_error` recorded; the next retry delivers on the new key | ☐ | Drill a provider that rejects the key once; check the key changed and `emails_sent` rises on the next run |
| RF-02 rate limit: `Retry-After` honored for `rate_limited`/`rate_limit_exceeded` without `statusCode` (no fallthrough to generic backoff) | ☐ | Drill a 429 storm on staging; retry spacing follows `Retry-After` (30s cap) |
| Docs updated: `DOMAIN.md` §2.5 (`sent` = accepted, not delivered + frozen body/key) and `RUNBOOK-reminders.md` §3 (duplicate tracing via `email_idempotency_key`) | ☐ | Review the doc contents; the decision aligns with §4 "no bounce/complaint webhook" |
| Release from a clean diff holding ONLY verified fixes (RF-01 + RF-02), not the whole working tree | ☐ | See §6: the working tree mixes parallel feature work |

### 10e. Post-deploy verification — RF-04 single-flight + RF-06 idempotency + RF-07 mid-run edit + RF-08 poison terminal (2026-09-21)

Changes (migration + code; see `docs/audits/reliability-failure-modes-audit-2026-09-21.md`):

- **RF-04 — single-flight run lock:**
  `supabase/migrations/20260921050000_reminder_run_single_flight.sql`
  (partial unique index `reminder_runs_single_active` on `status = 'running'`).
  `run-evaluate.ts` claims the lock via the ledger insert: `23505` → early exit
  `{ skipped: true, runId: null }`; a crashed run is reclaimed when `startedAt` is older
  than `RUN_LOCK_STALE_MS` (30 minutes). `cron.ts` reports `outcome: "skipped"`.
- **RF-06 — idempotent threshold POST:**
  `tasks.ts` POST `/:id/thresholds` uses `Idempotency-Key`
  (`beginIdempotent`/`completeIdempotent`); an existing offset + different key
  → re-read existing → `200 { threshold }` (not `409`). The frontend
  (`threshold-manager.tsx`, `actions/tasks.ts`) sends the key and regenerates it
  after success.
- **RF-07 — cancel sends when the deadline/threshold is edited mid-run:**
  the per-batch live re-check also fetches `tasks.deadline_updated_at` + the
  `reminder_thresholds` version; on change the delivery is deleted (`DELETE`) before
  `claimUserSendBudget` (quota unspent) and the next run re-evaluates.
- **RF-08 — poison `missing task/recipient` terminal:**
  both `!task || !to` branches in `run-evaluate.ts` call
  `markFailed(id, MAX_EMAIL_DELIVERY_RETRIES, …)` so `retry_count = 3`
  (the evaluator stops offering retries). The `emailsPoisoned` counter feeds
  `isSystemicReminderFailure` and is excluded from the blackout decision; still
  counted in the ledger `emails_failed` and included in log/Sentry extras.
- **Schema:** `schema.ts` (+single-flight `uniqueIndex`), `schema-contract.ts`,
  `schema.test.ts`, `schema-drift.test.ts` (migration count 38→39, latest version
  `20260921050000`).

| Item | Status | How to verify |
|---|---|---|
| Migration `20260921050000_reminder_run_single_flight.sql` applied (`bun run db:migrate`, then `db:verify`) | ☐ | `supabase/verify-prod.sql`: zero pending; index `reminder_runs_single_active` exists (partial, unique) |
| RF-04 lock works: two concurrent cron triggers → one full run, one `outcome: "skipped"` with no work | ☐ | Trigger `/api/v1/cron/evaluate-reminders` twice in parallel; `[reminders] skipped, another run is active` log; `reminder_runs` has no two `running` rows |
| RF-04 reclaim: a `running` row stuck >30 min is errored by the next run, then the lock is taken | ☐ | Insert a `running` row with backdated `started_at` on staging; run cron; assert the old row is `status='error'` + a new run succeeds |
| RF-06 replay: POST threshold with the same `Idempotency-Key` twice → one row + identical second response (200) | ☐ | `curl` the identical POST with the same header; check `idempotency_keys` + `reminder_thresholds` row count |
| RF-06 natural-key: POST an existing offset with a different key → `200 { threshold }` (not `409`) | ☐ | Re-`curl` the existing offset with a new/no key; assert 200 and the existing threshold id |
| RF-07 cancel: editing the deadline/threshold between batch snapshot and send → no email sent, delivery row deleted, quota unspent | ☐ | Staging with stubbed-slow send; edit the deadline mid-run; `[reminders] skipped send, task edited mid-run` log; the next run sends with the new deadline |
| RF-07 negative: an unrelated edit (title/status) does NOT cancel the send | ☐ | Edit the title mid-run; assert the email still sends (body uses the RF-02 frozen snapshot) |
| RF-08 terminal: delivery without profile/email → `retry_count = 3` on the first run, no retry after | ☐ | Staging: blank/remove the profile email (or an orphaned task) for one delivery; run cron 5×; assert `retry_count = 3` with no further retries |
| RF-08 no false blackout: a run holding only poison does NOT raise the Sentry "blackout" alert | ☐ | Scenario above with poison as the only work; assert no Sentry message and `emailsPoisoned >= 1` in the log |
| Release from a clean diff holding ONLY verified fixes (RF-04 + RF-06 + RF-07 + RF-08), not the whole working tree | ☐ | See §6: the working tree mixes parallel feature work |

### 10f. Post-deploy verification — RF-09 threshold archive + RF-10 offset identity (2026-09-21)

Required migration: `supabase/migrations/20260921060000_threshold_archive.sql` (`reminder_thresholds.deleted_at` column, partial unique `reminder_thresholds_task_days_before_active_key`, quota-enforcing `enforce_threshold_quota` active-only filter, drop `thresholds_delete_own` policy, `threshold_forbid_delete` trigger).

- **RF-09 — deleting a threshold = archiving:**
  - `PUT /tasks/:id/thresholds` dropping an offset → the `reminder_thresholds` row stays with `deleted_at` set; old `sent/failed/pending` deliveries are **not** deleted with it.
  - `DELETE /tasks/:id/thresholds/:thresholdId` returns `200` and archives (not hard-deletes).
  - Direct hard deletes (PostgREST/SQL) are rejected with `THRESHOLD_HARD_DELETE_FORBIDDEN`; deleting a task/user still cascades (RI).
- **RF-10 — per-offset delivery identity:**
  - An offset that was `sent`, then deleted and re-added, does not send a second email.
  - `pending` deliveries under an archived threshold are never sent (swept as stale).

| Item | Status | How to verify |
|---|---|---|
| Migration `20260921060000` installed: `deleted_at` present, partial unique active, old policy gone, guard trigger present | ☐ | `bun run db:verify`; `select indexname from pg_indexes where tablename='reminder_thresholds'`; `select tgname from pg_trigger where tgrelid='reminder_thresholds'::regclass` |
| PUT dropping an offset → threshold row archived, old deliveries intact | ☐ | Staging: send H-1 (sent) → PUT without H-1 → assert `deleted_at` set + the H-1 `notification_deliveries` row still present |
| DELETE threshold returns 200 and archives | ☐ | `curl -X DELETE .../thresholds/<id>`; assert 200 and `deleted_at not null` |
| Direct hard delete rejected | ☐ | `delete from reminder_thresholds where id='<id>'` in the SQL editor → `THRESHOLD_HARD_DELETE_FORBIDDEN` error |
| Task cascade still works (guard does not block RI) | ☐ | Delete a task on staging → its threshold rows go with it, no guard error |
| Re-added sent offset does not resend | ☐ | Staging: send H-1 → delete → re-add H-1 → run cron; assert no second email (the H-1 `notification_deliveries` stays one `sent` row) |
| Quota counts active thresholds only | ☐ | Archive one threshold at full quota → adding a new offset succeeds; assert `enforce_threshold_quota` counts `deleted_at is null` |
| Release from a clean diff holding ONLY verified fixes (RF-09 + RF-10), not the whole working tree | ☐ | See §6: the working tree mixes parallel feature work |

## 11. Pre-scale-out — single-node authz cache (P2-5, 2026-09-21)

Decision: the authz snapshot stays an in-memory `Map` with a 30s TTL (`apps/api/src/lib/authorization/cache.ts`)
for the single-replica MVP (per the single-replica decision above). Not a problem today;
it becomes one at horizontal scale (snapshots not shared across instances, full refetch per nav).

| Item | Status | How to verify |
|---|---|---|
| BEFORE horizontal scale: move the authz snapshot to Redis (same `REDIS_URL`) or accept DB hits and drop the local map | ☐ | Authz cache hit rate; per-request authz queries in APM |
| Next `revalidate`/`staleTime` only for genuinely static reads — not for session-gated lists | ☐ | Review when adding read caching |

## 12. Post-deploy verification — perf plan 2026-09-26

Reference: `docs/performance-audit-2026-09-26.md`. Baseline: `sh scripts/perf-probe.sh`
before changes (logs in `scripts/perf-logs/`, gitignored).

| Item | Status | How to verify |
|---|---|---|
| Railway region = US East, 1 replica (`railway status`) | ☑ (2026-09-26, CLI) | `region: US East`, `sfo (0) · US East (1)` |
| Supabase project `us-east-1`: 41 migrations applied, 0 pending | ☑ (2026-09-27) | 42/42 applied, `db:verify` + `verify-prod.sql` exit 0 (12 RLS, 17 policies, private bucket, quota triggers), green `db:drift` |
| Upstash Redis region = US East | ☐ | `[perf]` on 401: 181ms → ~5–15ms |
| Vercel Build Command = double-build chain (`DEPLOY-PROD.md` §3) | ☑ (2026-09-26, API) | Build log contains `[csp-hashes] verify ok`; `/login` answers `sha256` (no `nonce-`) + `s-maxage` |
| ENV-API: 5 new Supabase values + new `REDIS_URL` synced (`scripts/sync-prod-env.ts --apply`) | ☑ partial (2026-09-27) | Railway+GitHub via script; Vercel via `--only web --vercel-project`; explicit API redeploy (`redeploy --yes`) since env change does not trigger redeploy |
| ENV-WEB: new `NEXT_PUBLIC_SUPABASE_*` + redeploy (inlined at build) | ☑ (2026-09-27) | Redeploy via empty commit `e13d1cb` (CLI deploy from subdir failed — rootDir); new-project JWKS 200 |
| Re-probe after all phases, numbers into audit §2 "after" column | ☑ partial (2026-09-27) | Audit §2b; remaining: final re-probe after the Upstash move |
| Sentry traces (0.1) on in ENV-API + ENV-WEB when DSN filled | ☐ | `GET /api/v1/bootstrap` span visible in Sentry |
| Release from a commit holding ONLY this plan's verified changes | ☑ (2026-09-27) | `1343602`, `4aec301`, `f286be5`, `e13d1cb` — plan + redeploy only; clean tree |
