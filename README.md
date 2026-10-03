# Deadline Radar

[![beta](https://img.shields.io/badge/status-beta-yellow)](https://github.com/epo33m/deadline-radar/releases/tag/v0.1.0-beta.2) [![live](https://img.shields.io/badge/demo-live-brightgreen)](https://dr.rapm.space)

Personal academic task tracker that helps students monitor coursework and meet deadlines through a centralized Summary and tiered reminders (email + in-app).

> **Beta ([v0.1.0-beta.2](https://github.com/epo33m/deadline-radar/releases/tag/v0.1.0-beta.2))** — live at [dr.rapm.space](https://dr.rapm.space). Expect rough edges; bug reports with the `ref:` code shown under any error are gold. Your beta 1 account and data carry over — no re-registration needed.

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

**One env file, at the root.** `apps/web/` must not contain a `.env*` file.
Next auto-loads `.env.local`, `.env.production`, and friends from the app
directory in `next dev`, `next build`, and `next start`, so a file placed there
is merged into the web process's environment whether or not anything asked for
it — which is how a Vercel production token ended up in the e2e web process
(#71). The e2e suite refuses to start if it finds one; `apps/e2e/README.md`
has the detail. Local values go in the root `.env.local`; Vercel credentials go
in `vercel login` or the project's dashboard, never in this repo.

Apply every migration in `supabase/migrations/` **in filename order**. Do not
cherry-pick a subset — later files depend on earlier ones. `supabase/config.toml`'s
`major_version = 15` is stale; the project runs PostgreSQL 17.

In Supabase Auth settings for local MVP: disable **Confirm email**, and set Site URL to `http://127.0.0.1:3025`.

```bash
bun run dev:staging    # API :4025 + web :3025 — reads .env.staging (required)
bun run test:scripts   # explicit-target guard unit tests (no DB needed)
bunx nx run-many -t test
```

Stop local servers with Ctrl-C / `SIGTERM`, never `kill -9`: the API drains
in-flight queries and the Postgres pool on `SIGTERM`/`SIGINT`, while `kill -9`
abandons pooled connections for the server to reap — the dangling-connection
shape that aggravated the staging stall behind #89. (A single failed query can
no longer kill the process either: it answers 500 and the server keeps
serving; see `apps/api/src/lib/process-guard.ts`.)

Bare `dev`, `dev:web`, `dev:api`, and `db:migrate|status|verify|drift` refuse
to start: they used to load `.env.local` (production) implicitly, which was a
default path from local tooling to production (#63). Name the target
explicitly with the `:staging` variant. Production is reachable only
deliberately — an explicit env file plus `--allow-production` on the script
itself, never a default and never an environment variable.

## Staging database (UI work)

`.env.local` points at **production**. Anything that writes data belongs on
staging.

A staging Supabase project — separate project, PostgreSQL 17, its own Auth — is
provisioned by `bash scripts/setup-staging-project.sh`. It walks the dashboard,
writes `.env.staging` (gitignored, like `.env.local`), and registers the
`staging` GitHub environment secret that `.github/workflows/deploy-staging.yml`
reads. Then:

```bash
bun run db:migrate:staging   # apply pending migrations
bun run db:verify:staging     # assert zero pending
bun run db:drift:staging      # schema-contract check, zero drift
bun run dev:staging           # API + web against staging
bun run seed:staging          # ui-review@example.test + courses/tasks
bun run seed:staging -- --reset   # archive everything and reseed
```

Sign in at http://127.0.0.1:3025 with `ui-review@example.test` /
`UiReview-Staging-1!` (created by the seed script).

`scripts/lib/target.ts` is the single explicit-target guard for local
tooling: `scripts/dev.ts` refuses to start without a named env file, refuses a
mixed env file whose `DATABASE_URL` and `SUPABASE_URL` name different Supabase
projects, and refuses production unless `--allow-production` is passed
deliberately. `scripts/migrate.ts`, `scripts/verify-schema-drift.ts`, and
`scripts/seed-staging.ts` enforce the same deny list (seed has no production
escape hatch), and no refusal prints secret values — keys and files only.

OpenAPI UI: [http://127.0.0.1:4025/openapi](http://127.0.0.1:4025/openapi) (also rewritten via the web origin).

Trigger reminder evaluation locally (no `CRON_SECRET` required outside production):

```bash
curl http://127.0.0.1:4025/api/cron/evaluate-reminders
```

## Status

MVP in progress on Nx + Elysia backend. Set `DATABASE_URL` and `SUPABASE_JWT_SECRET` before exercising authenticated API routes.
