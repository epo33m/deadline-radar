# Deadline Radar

Personal academic task tracker that helps students monitor coursework and meet deadlines through a centralized dashboard and tiered reminders (email + in-app).

## Features

- **Auth** — Register and login with email/password; per-user data isolation
- **Courses** — CRUD for courses (name, optional code and color)
- **Tasks** — CRUD with deadline, status, estimated duration, and course assignment
- **Attachments** — File uploads or external links per task
- **Reminders** — Default thresholds H-7 / H-3 / H-1 / H-0; customizable per task; email (Resend) and in-app delivery
- **Dashboard & calendar** — Approaching, overdue, and recently completed tasks; monthly deadline view

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
| API contract | OpenAPI |
| Email | Resend |

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
| [docs/agents/](docs/agents/) | Agent issue tracker, triage labels, domain-doc layout |

Product docs under `docs/` are the source of truth. Engineering work follows the Matt Pocock skills wired in `AGENTS.md`.

## Getting started

```bash
bun install
cp .env.example .env.local   # fill DATABASE_URL, Supabase, JWT secret, Resend, CRON_SECRET
```

Apply migrations in the Supabase SQL Editor (in order):

1. `supabase/migrations/20260901000000_profiles.sql`
2. `supabase/migrations/20260901010000_courses.sql`
3. `supabase/migrations/20260901020000_tasks.sql`
4. `supabase/migrations/20260901030000_attachments.sql`
5. `supabase/migrations/20260901040000_notification_deliveries.sql`

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
curl http://127.0.0.1:4025/api/cron/evaluate-reminders
```

## Status

MVP in progress on Nx + Elysia backend. Set `DATABASE_URL` and `SUPABASE_JWT_SECRET` before exercising authenticated API routes.
