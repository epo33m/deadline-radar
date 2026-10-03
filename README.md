# Deadline Radar

[![v1.0.0](https://img.shields.io/badge/release-v1.0.0-blue)](https://github.com/epo33m/deadline-radar/releases/tag/v1.0.0) [![live](https://img.shields.io/badge/demo-live-brightgreen)](https://dr.rapm.space)

Personal academic task tracker that helps students monitor coursework and meet deadlines through a centralized Summary and tiered reminders (email + in-app).

> **v1.0.0 is out 🎉** — live at [dr.rapm.space](https://dr.rapm.space). Bug reports carry the `ref:` code shown under any error message.

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

See [CONTRIBUTING.md](CONTRIBUTING.md) for setup, running locally, testing, and deployment.

## Contributing

Contributions welcome — read [CONTRIBUTING.md](CONTRIBUTING.md) first. Product docs under `docs/` are the source of truth; engineering work follows the Matt Pocock skills wired in `AGENTS.md`.
