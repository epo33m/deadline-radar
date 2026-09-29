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
- Root **`.env.staging`** (not `.env.local`) filled: `DATABASE_URL`,
  `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`,
  `AUTH_BRIDGE_SECRET`, `CRON_SECRET`. It is written by
  `bash scripts/setup-staging-project.sh`; see the root README, "Staging
  database".
- The Supabase project used must have **email confirmation disabled**
  (register returns a session immediately)
- Ports `4025` (API) and `3025` (web) free — the suite always boots its own
  API and web, it never adopts a server that is already listening

## Install (once)

```sh
bun install
./apps/e2e/node_modules/.bin/playwright install chromium
```

## Target selection

**The suite never picks its own target.** `E2E_TARGET` names one entry in
`TARGETS` (`target.ts`), and that entry alone decides the env file, the origins,
and the ports. There is exactly one target, because dev/staging are the same
local stack and only production is deployed (see `docs/PROD_ENV_CHECKLIST.md`).

| Variable | Meaning |
| -------- | ------- |
| `E2E_TARGET` | **Required.** `staging` → `http://127.0.0.1:3025`, env `.env.staging` |

`E2E_TARGET` is re-asserted to the resolved name, so a stale or hostile shell
value is replaced rather than trusted.

The root `.env.local` points at **production**, so it is never read by this
suite — not directly, and not transitively through any wrapper. `bun run
test:e2e` with no `E2E_TARGET` refuses to start and says so:

```
✗ E2E_TARGET is not set.

The E2E suite never picks its own target. Name the one you want:

  E2E_TARGET=staging   →  http://127.0.0.1:3025  (env: .env.staging)

Production is not a valid target and cannot be added by setting a variable.
```

### Production is refused

Production is a deny list, not a target. Before anything starts, the resolved
target's env file and the target's own origins are matched against the
production Supabase project ref and the production hosts. A match refuses the
run and prints what resolved, so the mistake is obvious:

```
✗ E2E_TARGET=staging resolves to production. Refusing to start.

  .env.staging  DATABASE_URL  →  postgresql://postgres.bhtfk…:…@aws-0-us-east-1…  (bhtfkuzsdxrdmvvcczse)
  .env.staging  SUPABASE_URL  →  https://bhtfkuzsdxrdmvvcczse.supabase.co  (bhtfkuzsdxrdmvvcczse)
```

No environment variable and no escape hatch makes a production run the default
or the easy option. Adding production to `TARGETS` is a code change, and a
reviewable one.

### What the started processes inherit

Playwright launches the `webServer` children as
`{ ...defaults, ...process.env, ...server.env }`, so the **runner's own
environment is the boundary**. It is narrowed to the target's variables plus a
few host-level ones, which means:

- the root `.env.local` never reaches the API or the web process;
- a `DATABASE_URL` or `SUPABASE_*` value sitting in your shell is discarded in
  favour of the target's;
- `NODE_ENV` is dropped, so a stray `NODE_ENV=production` in your shell cannot
  flip the API into production mode. `apps/api/src/env.ts:19` only asserts
  `CRON_SECRET` / `AUTH_BRIDGE_SECRET` / `REDIS_URL` when
  `NODE_ENV === "production"`, and the Redis rate-limit, schema-prereq,
  Resend, and cutoff checks are all production-only. A staging run must not be
  in that mode, and it must not be blocked by production requirements either.
- the old `E2E_WEB_ORIGIN` / `E2E_API_ORIGIN` / `E2E_WEB_PORT` overrides are
  gone. The target decides the origins.

Every worker process re-imports the Playwright config and resolves the target
again, so a worker cannot silently run against a different target than the one
the runner picked.

## Run

```sh
# From the repo root. Builds the web app first (nx-cached, resolved against the
# same target so the baked API_ORIGIN rewrite matches), then boots API + web:
E2E_TARGET=staging bun run test:e2e

# Single file / single test:
E2E_TARGET=staging bun run test:e2e -- smoke.spec.ts
E2E_TARGET=staging bun run test:e2e -- link-attachment.e2e.spec.ts
E2E_TARGET=staging bun run test:e2e -- -g "E2E-01"

# Straight to the Playwright CLI (skips pretest:e2e, so build the web app
# yourself with E2E_TARGET=staging bun run build). The config imports the
# target module, so run it from inside the package:
cd apps/e2e
E2E_TARGET=staging ./node_modules/.bin/playwright test smoke.spec.ts
```

Do not use `bun --cwd apps/e2e run <script>`: bun resolves the path as a
*script name pattern* and runs unrelated scripts. Use the root
`bun run test:e2e` from the repo root, or `cd apps/e2e` first.

## Test isolation
- Every run generates unique emails (`e2e-<runTag>@example.test`), course/task
  names, and URLs — reruns never collide with leftovers.
- `afterAll` deletes created attachments, archives tasks/courses, and deletes
  the auth users via the Supabase Admin API → (near-)zero residue.
- Serial execution (`workers: 1`) keeps ordering deterministic and stays far
  below the API rate limits (auth-sensitive bucket: 20 req/min).
- Tests only touch rows they created; development/production data is unaffected
  (fixtures are namespaced per run and cleaned up).

## Target resolution tests

`bun run test` (repo root) includes `e2e:test`, which runs `target.test.ts`:
it proves each refusal (no `E2E_TARGET`, unknown `E2E_TARGET`, missing env
file, and a target resolving to production) and that the root `.env.local` is
never a source. It needs no database and no secrets.

```sh
bunx nx run e2e:test
```
