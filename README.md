# Deadline Radar

[![beta](https://img.shields.io/badge/status-beta-yellow)](https://github.com/epo33m/deadline-radar/releases/tag/v0.1.0-beta.1) [![live](https://img.shields.io/badge/demo-live-brightgreen)](https://deadline-radar-web.vercel.app)

Personal academic task tracker that helps students monitor coursework and meet deadlines through a centralized Summary and tiered reminders (email + in-app).

> **Beta ([v0.1.0-beta.1](https://github.com/epo33m/deadline-radar/releases/tag/v0.1.0-beta.1))** — live at [deadline-radar-web.vercel.app](https://deadline-radar-web.vercel.app). Expect rough edges; bug reports with the `ref:` code shown under any error are gold. Note: accounts from before 2026-09-27 don't carry over (fresh Supabase project) — please re-register.

## Features

- **Auth** — Register and login with email/password; per-user data isolation
- **Courses** — CRUD for courses (name, optional code and color)
- **Tasks** — CRUD with deadline, status, and course assignment
- **Attachments** — File uploads or external links per task
- **Reminders** — Default thresholds H-7 / H-3 / H-1 / H-0; customizable per task; email (Resend) and in-app delivery
- **Summary & calendar** — Approaching, overdue, and recently completed tasks; monthly deadline view

## Tech stack

| Layer | Choice |
|---|---|
| Package manager | Bun (workspaces) |
| Monorepo | Nx |
| UI | Next.js App Router (`apps/web` :3025) |
| API | Elysia on Bun (`apps/api` :4025) |
| Language | TypeScript |
| Styling | Tailwind CSS + shadcn/ui |
| Validation | Zod (`packages/validation`) |
| ORM | Drizzle (`packages/db`) |
| Domain | Reminder evaluation (`packages/domain`) |
| Auth / DB / Storage | Supabase (Auth + Postgres + Storage) |
| Rate limiting | Upstash Redis |
| API contract | OpenAPI |
| Email | Resend |
| Errors & traces | Sentry (web + api) |

Use `bun` / `bunx` for install, scripts, and package adds. Do not use npm, npx, yarn, or pnpm in this repo.

## Documentation

| Document | Description |
|---|---|
| [docs/product.md](docs/product.md) | Product requirements (PRD) |
| [docs/MVP.md](docs/MVP.md) | MVP scope and core flows |
| [docs/DOMAIN.md](docs/DOMAIN.md) | Domain model and business rules |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | System architecture |
| [docs/diagrams/mvp-architecture.html](docs/diagrams/mvp-architecture.html) | Interactive MVP architecture map (Archify) |
| [docs/DATA-MODEL.md](docs/DATA-MODEL.md) | Schema, triggers, and RLS |
| [docs/DEPLOY-PROD.md](docs/DEPLOY-PROD.md) | Production deploy runbook (Railway + Vercel + Supabase) |
| [docs/RUNBOOK-reminders.md](docs/RUNBOOK-reminders.md) | Reminder delivery operations |
| [docs/performance-audit-2026-09-26.md](docs/performance-audit-2026-09-26.md) | Performance audit + remediation evidence |
| [docs/PROD_ENV_CHECKLIST.md](docs/PROD_ENV_CHECKLIST.md) | Production env + verification checklist |
| [docs/agents/](docs/agents/) | Agent issue tracker, triage labels, domain-doc layout |

Product docs under `docs/` are the source of truth. Engineering work follows the Matt Pocock skills wired in `AGENTS.md`.

## Getting started

```bash
bun install
cp .env.example .env.local   # fill DATABASE_URL, Supabase, JWT secret, Resend, CRON_SECRET
bun run db:migrate           # apply all migrations (Supabase CLI)
bun run db:verify            # assert zero pending
```

In Supabase Auth settings for local MVP: disable **Confirm email**, and set Site URL to `http://127.0.0.1:3025`.

```bash
bun run dev          # API :4025 + web :3025
bun run dev:web      # UI only
bun run dev:api      # API only
bunx nx run-many -t test
```

OpenAPI UI: [http://127.0.0.1:4025/openapi](http://127.0.0.1:4025/openapi) (also rewritten via the web origin).

Trigger reminder evaluation locally (no `CRON_SECRET` required outside production):

```bash
curl http://127.0.0.1:4025/api/v1/cron/evaluate-reminders
```

## Operations

Production topology (all server-side US East): Vercel (web) → Railway (API) → Supabase (`us-east-1`) + Upstash. Details in [docs/DEPLOY-PROD.md](docs/DEPLOY-PROD.md).

```bash
sh scripts/perf-probe.sh            # latency baseline vs prod (read-only)
bun run scripts/auth-smoke.ts       # register→login→bootstrap→cleanup vs prod
bun run scripts/verify-deploy.ts    # post-deploy gate (commit, forms, CSP, envelopes)
bun run apps/api/scripts/sentry-drill.ts --tag <name>   # prove a Sentry alert fires
```

- Scheduler: GitHub Actions hourly (`.github/workflows/cron-reminders.yml`) → `GET /api/v1/cron/evaluate-reminders`; health at `/health/cron`.
- Smoke suite: `.github/workflows/smoke-prod.yml` runs auth-smoke + verify-deploy on every push to `main` and every 6 hours.
- E2E (Playwright, manual pre-release): `bun run test:e2e` — see `apps/e2e/README.md`.

## Status

Beta v0.1.0-beta.1, deployed. Set `DATABASE_URL` and `SUPABASE_JWT_SECRET` before exercising authenticated API routes.
