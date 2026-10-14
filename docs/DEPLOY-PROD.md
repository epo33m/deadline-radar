# Production Deploy — Deadline Radar

> Status 2026-09-26: the repo has **no** auto-deploy yet. Pushing to `main`
> only triggers CI (`.github/workflows/ci.yml`). Deploys happen from the
> Railway dashboard (API) and Vercel (Web) using the `main` branch.
> Env checklist + verification stay in `docs/PROD_ENV_CHECKLIST.md`.
> Region architecture (perf plan 2026-09-26, `docs/performance-audit-2026-09-26.md`):
> Web `iad1` (Vercel Hobby, locked) + API **US East** (Railway) + DB
> **`us-east-1`** (Supabase) + Redis **US East** (Upstash). All server-side
> in one region; the `sin1`↔`iad1` hop (~400–500ms) is the Hobby ceiling.

## 0. Prerequisites (verified 2026-09-26, read-only)

| Item | Result |
|---|---|
| Prod migrations | 41 applied, **0 pending** (`bun run db:migrate status`) — requirement N-4 met |
| Prod tables | 12 public tables complete (`reminder_thresholds`, `reminder_runs`, …) |
| Prod data | `tasks` 0, `notification_deliveries` 0, `reminder_runs` 0 → no scheduler has ever run |
| `.env.production` (local, operator) | `assertStartupConfig()` PASS (RF-11/RF-13 fail-closed) |
| Redis (Upstash `rediss://`) | `PING → PONG` |
| Resend | domain `rapm.space` **verified** |
| Web | not deployed yet → `WEB_ORIGIN` still a placeholder |

Secrets never enter the repo. `.env.production` is only an operator
reference; the env actually used is the Railway/Vercel secret store.

## 1. Deploy order (MUST be sequential)

1. `bun run db:migrate` (new code before its API) + `db:verify` — without this
   the `sending` enum / `claimed_at` column do not exist and every cron run 500s
   (RF-15, `assertReminderSchemaPrerequisites` refuses to boot).
2. Deploy the **API** to Railway.
3. Fill `WEB_ORIGIN` in Railway with the public Vercel domain (needed for CORS +
   cookies), then redeploy/restart the API.
4. Deploy the **Web** to Vercel (Root Directory `apps/web`).
5. Fill `API_ORIGIN` in Vercel = the Railway domain, then **redeploy** — the
   `next.config.ts` rewrite is baked at build time, so an env change alone
   is not enough without a new build.
6. Trigger the first cron run manually (§4) and verify §6.

## 2. Railway — API

Config files: `railway.json` + `Dockerfile` (root). Railway cannot
auto-detect Bun, so the Dockerfile is required; build context = repo
root so the Bun workspace installs from the correct lockfile.

Dashboard steps:
1. **New Project → Deploy from GitHub repo** (`epo33m/deadline-radar`).
2. API service: **Root Directory = `/`** (default; NOT `apps/api`, because
   `bun.lock` + `packages/*` live at the root), builder **Dockerfile** (from
   `railway.json`).
3. **Region = US East** (Virginia — same region as Vercel `iad1`,
   Supabase `us-east-1`, Upstash US East; perf plan 2026-09-26 §R1).
   CLI: `railway service scale us-east=1` then `railway service scale sfo=0`
   (stay at 1 replica — single-replica decision).
   Note (#161): cross-replica authz cache invalidation depends on the
   generation counter in Redis (`authz:gen:<userId>`). `REDIS_URL` is already
   required in prod, so this is safe at 1 replica; if scaled later, make sure
   Redis stays populated — without it one revoke only clears the serving
   replica, and other replicas may serve a stale snapshot until TTL expiry.
4. Fill env in **ENV-API** (Variables tab). Start command and port are already set
   in the `Dockerfile` (`API_PORT=${PORT:-$API_PORT}`) — leave empty.
5. Deploy. No rewrite needed; the service public domain is used
   as `API_ORIGIN` in Vercel and `PROD_API_URL` in the GitHub secret.

| Var | Notes |
|---|---|
| `NODE_ENV` | `production` (already set as `ENV` in the image) |
| `REMINDER_CUTOFF_ISO` | **required** (RF-11). The agreed scheduler activation value; may move forward, never backward |
| `DATABASE_URL` | Supabase pooler, `prepare:false` already in code. **Region `us-east-1`** (new project post-2026-09-26; perf plan §R1). Moving region = new project: `bun run db:migrate` + `db:verify` + `supabase/verify-prod.sql` §1–§5 + recreate the `attachments` bucket + re-register users |
| `SUPABASE_URL` / `SUPABASE_ANON_KEY` / `SUPABASE_SERVICE_ROLE_KEY` | service_role must **never** go to Vercel |
| `CRON_SECRET` | long random; same as the `CRON_SECRET` GitHub secret |
| `AUTH_BRIDGE_SECRET` | **must be identical** to the value in Vercel |
| `REDIS_URL` | required (SEC-007). **Region US East** (same region as the API; perf plan §R4 — far INCR = ~180ms per request) |
| `REDIS_TIMEOUT_MS` | optional, default **250** (memory fallback + warn when Redis is slower; also the per-command bound in transports: ioredis `commandTimeout`/`connectTimeout` + Upstash REST abort signal, including the auth-abuse login throttle) |
| `RESEND_API_KEY` / `RESEND_FROM_EMAIL` | Resend-verified domain |
| `WEB_ORIGIN` | public Vercel origin (cookies/CORS) |
| `AUTH_AUDIT_RETENTION_DAYS` | `90` (audit ROUND 1 decision) |
| `SENTRY_DSN` | optional; Sentry is off when empty |

Healthcheck: `railway.json` → `/health` (static `200 {ok:true}`, no DB,
rate-limit exempt). This endpoint is **not** proof the scheduler is alive — that is
`/health/cron` (§6).

## 3. Vercel — Web

No `vercel.json` on purpose: Vercel auto-detects the Nx monorepo + `bun.lock`.
Settings to fill in manually:

| Setting | Value |
|---|---|
| Root Directory | `apps/web` |
| Install Command | `bun install` (default; Vercel looks up `bun.lock` toward the parent) |
| Build Command | `next build && bun scripts/verify-routes.ts && bun scripts/build-csp-hashes.ts && next build && bun scripts/build-csp-hashes.ts --verify` (route gate + double-build hash-CSP, Phase C/W1; SAME as `bun run build`) |
| Output Directory | `.next` (default) |
| Function Region | `iad1` default (Hobby locked; latency ceiling, see perf audit §R2) |

Env in **ENV-WEB** (Project Settings → Environment Variables, production
environment — production only, not preview/dev):

| Var | Notes |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_ANON_KEY` | inlined at build time |
| `API_ORIGIN` | Railway domain; used for the `/api/*`, `/openapi`, `/health` rewrites |
| `AUTH_BRIDGE_SECRET` | **must match** Railway |
| `SUPABASE_JWT_SECRET` | optional (legacy HS256) |
| `NEXT_PUBLIC_SENTRY_DSN` | optional |

`NEXT_PUBLIC_*` is inlined at build time → refilling must come with a redeploy.

## 4. Scheduler trigger (cron)

Default: **GitHub Actions** `.github/workflows/cron-reminders.yml`
(`0 * * * *` UTC), calling `GET /api/v1/cron/evaluate-reminders` with
`Authorization: Bearer $CRON_SECRET`. GitHub secrets to create:
`PROD_API_URL` (Railway domain) + `CRON_SECRET`.

Why not `cronSchedule` in `railway.json`: Railway executes the service
**start command** on schedule, and `railway.json` applies to the whole repo
(not per-service) — a cron on the API service would boot the API every hour.
Alternative if wanted: a second Railway service (`scheduler`) with start command
`curl -fsS -H "Authorization: Bearer $CRON_SECRET" https://<api>/api/v1/cron/evaluate-reminders`
and cron `0 * * * *` on that service's dashboard only.

Overlap is safe: the single-flight lock (`reminder_runs_single_active`) makes
the second call exit `skipped` with no work.

## 5. Rollback

- API code: redeploying the previous Railway revision is safe (a leftover
  `sending` enum is ignored by the old sweep claim).
- Migrations: rolling back the `sending` enum is impossible while `sending`
  rows exist (see `docs/RUNBOOK-reminders.md` §6).

## 6. Post-deploy verification

1. `GET https://<api>/health` → `200 {ok:true, service:"deadline-radar-api"}`.
2. `GET https://<api>/openapi` → 200 (live API docs).
3. `GET https://<web>/health` → 200 (rewrite to the API through Vercel).
4. Manual trigger: GitHub Actions → Scheduler Trigger → Run workflow. The log must show
   `[cron] evaluate-reminders finished: …` in the Railway logs. ☑ (2026-09-27:
   manual trigger via API + hourly cron recorded `ok` in `reminder_runs`)
5. `GET https://<api>/health/cron` → **503 until the first `ok` run is recorded**
   (`reminder_runs` still 0 rows when this doc was written). After the first run it must be
   `200 {ok:true, lastRunAt, lastStatus, evaluatedTasks}`.
6. End-to-end login in the prod browser (the auth bridge needs the same
   `AUTH_BRIDGE_SECRET` on both sides) + one test task with an H-1 threshold
   to prove email really goes out. ☑ (2026-09-27: register 200 + login + H-0 task →
   `sent` delivery + email landed in the inbox; audit §9; test account deleted)
7. Attach an external monitor (UptimeRobot/StatusCake) to `/health/cron` every
   minute — alert on `503` (RF-14 MTTD).

## 7. Production installation record (2026-09-26)

| Item | Value |
|---|---|
| Railway project / service | `deadline-radar-api` / `deadline-radar-api` (`6886d8eb-b917-4820-bc2e-74ac3c0b16c2`) |
| API domain | `https://deadline-radar-api-production.up.railway.app` |
| Vercel project | `deadline-radar-web` (`prj_BT7yRuoU4Jw7MXggiQDenlfffovJ`), root `apps/web`, GitHub connected |
| Web domain | `https://dr.rapm.space` |
| GitHub secrets | `PROD_API_URL`, `CRON_SECRET` |

`API_ORIGIN` = API domain, `WEB_ORIGIN` = Web domain. `railway.json` is still
in use (deprecated CLI, keeps working until 2026-12-01; migrate to
`.railway/railway.ts` if needed). CLI: `railway link` (project + `production`
environment + service) is already attached in this repo, `vercel link` lives in
`apps/web/.vercel` (not committed).
