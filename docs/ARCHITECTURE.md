# Deadline Radar — Architecture

> **Source of truth:** `product.md` (Baseline v0.1) + `DOMAIN.md`

---

## 1. High-Level Architecture

```
┌─────────────┐        ┌──────────────────────────┐
│   Browser   │◀──────▶│  Next.js UI (apps/web)   │
│ (user)      │ :3025  │  App Router + RSC        │
└─────────────┘        └────────────┬─────────────┘
                                    │ same-origin rewrite /api/*
                                    │ httpOnly session cookies
                                    ▼
                       ┌────────────────────────┐       ┌──────────┐
                       │  Elysia API (apps/api) │──────▶│  Resend  │
                       │  Bun :4025 + OpenAPI   │       │ (email)  │
                       └────────────┬───────────┘       └──────────┘
                                    │
              ┌─────────────────────┼─────────────────────┐
              ▼                     ▼                     ▼
     ┌────────────────┐   ┌────────────────┐   ┌──────────────────┐
     │ Supabase Auth  │   │ Postgres       │   │ Supabase Storage │
     │ (identity)     │   │ via Drizzle    │   │ (attachments)    │
     └────────────────┘   └────────────────┘   └──────────────────┘
                                    ▲
                                    │ hourly (scheduler TBD)
                       ┌────────────────────────┐
                       │ Cron → GET /api/cron/  │
                       │ evaluate-reminders     │
                       └────────────────────────┘
```

## 2. Components

### 2.1 Frontend — Next.js (`apps/web`, port 3025)
UI only: pages, forms, and thin server actions that call the API over same-origin `/api/*` (Next rewrite → Elysia). Session gate uses the `dr_access_token` httpOnly cookie.

Main pages (indicative):
- `/login`, `/register`
- `/dashboard`, `/courses`, `/tasks`, `/tasks/[id]`, `/calendar`
- `/preferences`, `/preferences/notifications`
- Header bell — unread count via API

### 2.2 Backend — Elysia (`apps/api`, port 4025)
Owns **all auth, domain API, and business logic**:
- Auth: register, login, logout, password reset, session, timezone
- CRUD: courses, tasks, thresholds, attachments, notifications
- Cron: `GET /api/cron/evaluate-reminders` (Bearer `CRON_SECRET`)
- Contract: OpenAPI at `/openapi` (typed client under `apps/web/lib/api`)

Layering: **routes → services → Drizzle repos**. App-layer authorization by authenticated `user_id`. Existing Postgres RLS remains defense-in-depth.

### 2.3 Database — Supabase Postgres + Drizzle
- DDL / triggers / RLS: `supabase/migrations/` (source of schema truth for this branch)
- Query layer: `@deadline-radar/db` (Drizzle schema mirroring `DATA-MODEL.md`)
- Privileged `DATABASE_URL` from the API (service DB role)

### 2.4 Storage — Supabase Storage
- Private bucket `attachments`; API uses service role for upload/signed URLs
- Path: `attachments/{user_id}/{task_id}/{filename}`

### 2.5 Email — Resend
- Reminder emails from the API cron/evaluator path

### 2.6 Scheduler
- Endpoint lives on Elysia (`/api/cron/evaluate-reminders`)
- Production runner (pg_cron, external cron, host scheduler) remains **TBD** per `product.md`
- Local: `curl -H "Authorization: Bearer $CRON_SECRET" http://127.0.0.1:4025/api/cron/evaluate-reminders`

## 3. Data Flow: Reminder Evaluation (per run)

1. Scheduler hits the API cron route (hourly).
2. Job loads open tasks + thresholds + deliveries via Drizzle.
3. Pure domain logic (`@deadline-radar/domain` `evaluateReminders`) decides create/retry actions.
4. Insert/update `notification_deliveries`; send email via Resend; in-app rows marked `sent`.
5. UI polls notifications via API.

## 4. Auth & Security

- Supabase Auth for identity (email/password MVP).
- Elysia sets `dr_access_token` / `dr_refresh_token` httpOnly cookies after login/register/confirm.
- JWT verified via Supabase **JWKS** (ES256/RS256; legacy HS256 JWT secret optional fallback) on protected API routes **and** in the Next proxy.
- Invalid/expired tokens are cleared by `/api/auth/session` and on any API `401`.
- Backend rate limits (in-memory MVP): auth 30/min, general 180/min, cron 10/min; `Cache-Control: private, no-store` on `/api/*`.
- Browser talks to web origin only; Next rewrites `/api/*` to the API so cookies stay same-site.
- Env (see `.env.example`): `DATABASE_URL`, `SUPABASE_*`, `SUPABASE_JWT_SECRET`, `RESEND_*`, `CRON_SECRET`, `WEB_ORIGIN`, `API_ORIGIN`, `API_PORT`.

## 5. Folder Structure

```
/
  apps/web/                 # Next.js UI :3025
  apps/api/                 # Elysia + Bun :4025
  packages/db/              # Drizzle schema + client
  packages/validation/      # shared Zod schemas
  packages/domain/          # pure reminder evaluation
  supabase/migrations/      # SQL DDL / RLS / triggers
  docs/
  nx.json
  package.json              # Bun workspaces
```

## 6. Deployment
- Hosting: **TBD** (`product.md` §10). Local: Bun + Nx (`bun run dev`).
- Production scheduler / API host: **TBD**.

## 7. Open Architecture Questions
- [ ] Final production host for `apps/api` and cron runner.
- [ ] Final hosting for `apps/web`.
- [ ] Realtime notifications vs polling (MVP: polling).
- [ ] Storage cleanup when attachments/tasks are deleted.
- [ ] Max retry / backoff for failed emails (`DOMAIN.md` §7).
