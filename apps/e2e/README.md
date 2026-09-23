# E2E — link attachments

> **Status: advisory, non-blocking (F-7).** These suites are NOT wired into CI:
> they need Chromium, a production web build, and a live Supabase project
> (Auth with email-confirmation disabled, Admin API, Storage) plus remote
> secrets — none of which the CI `verify` job provides (vanilla PostgreSQL
> only). Run them manually pre-release / against staging. Wiring them into CI
> (e.g. a `supabase start` stack job) is deferred backlog, along with the
> journey specs below.
>
> Deferred journeys (not yet written): auth-gate (anon → login → session),
> task lifecycle (create → default thresholds exist), reminder → bell read →
> done-stops-reminders.
>
> Accepted risk (owner: epo33m, review: 2026-12-20): journeys stay manual
> until a `supabase start` CI job exists. Pre-release drill must go green once
> against staging before any public release (checklist §8/C6).

True end-to-end tests for task link attachments (`type = "link"`).
Design decision: links are **IMMUTABLE** (delete + recreate, no update endpoint).

## What is tested

| File | Type | Coverage |
| ---- | ---- | -------- |
| `tests/link-attachment.e2e.spec.ts` | Browser E2E (Chromium → Next.js → Server Action → live API → live Supabase Postgres → re-rendered DOM) | E2E-01 create + anchor attrs, E2E-02 reload persistence, E2E-03 remove + reload, E2E-04 invalid URL, E2E-05 dangerous schemes, E2E-06 cross-user authz + UI 404 |
| `tests/link-validation.http.spec.ts` | HTTP integration (live API + live DB, **no browser**, no mocks) | Characterization: http/https verbatim, query/fragment/slash verbatim, whitespace trimming, uppercase scheme, localhost/IP rejection, 3000-char URL, duplicates allowed, dangerous-scheme rejection |

Nothing is mocked: no `app.handle()`, no mocked DB/storage/auth, no mocked
Server Actions or API responses, no bare `safeParse()` assertions.

## Why `next start` (not `next dev`)

The browser suite runs against a **production build** (`next start`).
`next dev` (Turbopack) was verified to serve SSR HTML without ever hydrating
in headless Chromium in this environment (no React runtime attaches: password
toggle dead, form submits natively, zero client POSTs), while the production
bundle hydrates correctly. Production is also the more faithful E2E target.
`pretest:e2e` (nx, cached) guarantees the build exists before the run.

## Prerequisites

- Bun 1.4.0 (`bun --version`)
- Root `.env.local` filled (same file the dev scripts use): `DATABASE_URL`,
  `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`,
  `API_ORIGIN`, `WEB_ORIGIN`, `AUTH_BRIDGE_SECRET`
- The Supabase project used must have **email confirmation disabled**
  (register returns a session immediately) — true for the current dev project
- Ports `4025` (API) and `3025` (web) free, or reuse running dev servers

## Install (once)

```sh
bun install
bun --cwd apps/e2e x playwright install chromium
```

## Run

```sh
# From the repo root. Builds the web app first (nx-cached), then boots
# API + web automatically (reuses them if already running):
bun run test:e2e

# From apps/e2e:
bun run test:e2e

# Single file / single test:
bun --cwd apps/e2e x playwright test link-attachment.e2e.spec.ts
bun --cwd apps/e2e x playwright test link-validation.http.spec.ts
bun --cwd apps/e2e x playwright test -g "E2E-01"
```

## Test isolation
- Every run generates unique emails (`e2e-<runTag>@example.test`), course/task
  names, and URLs — reruns never collide with leftovers.
- `afterAll` deletes created attachments, archives tasks/courses, and deletes
  the auth users via the Supabase Admin API → (near-)zero residue.
- Serial execution (`workers: 1`) keeps ordering deterministic and stays far
  below the API rate limits (auth-sensitive bucket: 20 req/min).
- Tests only touch rows they created; development/production data is unaffected
  (fixtures are namespaced per run and cleaned up).

## Env overrides

- `E2E_WEB_ORIGIN` — point the browser at a different web origin
- `E2E_API_ORIGIN` — point fixtures at a different API origin
- `E2E_WEB_PORT` — web `webServer` port (default `3025`)
- `CI=true` — never reuse existing servers (always boot fresh)
