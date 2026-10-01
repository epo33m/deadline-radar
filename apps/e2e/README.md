# E2E — link attachments

> **Playwright CLI is mandatory for E2E work in this repo.**
> See [`PLAYWRIGHT-CLI.md`](./PLAYWRIGHT-CLI.md) — normative usage standard
> (per test type, target discipline, secrets hygiene). Review may reject E2E
> work without CLI evidence.

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

### Incident #64 — the run that reached production

While diagnosing the client runtime, the suite was run once without
`E2E_TARGET` and resolved production through the root `.env.local`.
Registration failed on the password grant (production requires email
confirmation), so the sign-up may still have created a user. Nothing has been
inspected, verified, or removed.

Decision (owner, recorded on issue #64): no production inspection, mutation,
or cleanup. This section is the preventive closure alongside the guards that
stop a repeat: explicit-target resolution (#62, `target.ts`), no default path
from local tooling to production (#63, `scripts/lib/target.ts` +
`refuse-default-prod.ts`), and the app-directory credential guard (#71,
`app-env.ts`). Do not claim the possible leftover user was removed — removal
was never performed nor verified.

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

### The app directory is not an env source

Narrowing the runner environment is necessary but **not sufficient**, and the
reason is specific to Next:

- `next dev`, `next build`, and `next start` all call `loadEnvConfig(appDir)`,
  which merges `.env.production.local`, `.env.development.local`, `.env.local`,
  `.env.production`, `.env.development`, and `.env` into `process.env` —
  regardless of the environment the process was spawned with.
- Bun loads the same filenames from its **cwd**, so even a non-Next child run
  inside `apps/web` inherits them.

`apps/web/.env.local` was created by `vercel dev` and held `VERCEL_OIDC_TOKEN`,
a production deployment credential, so it reached the web process no matter how
carefully the runner env was sanitised (#71). The file is gone; `app-env.ts` now
refuses to start if it comes back, checking every auto-loaded filename for a
Vercel credential key or a production identifier from the same deny list
`target.ts` uses. `VERCEL_PROJECT_ID` / `VERCEL_ORG_ID` are allowed — they grant
nothing and Vercel injects them into every build.

The guard runs in both process-launching entry points, before any child exists:
`with-target-env.ts` (build) and `playwright.config.ts` (run). Refusals print
the file, the key, and where the value belongs — never the value, which would
put the secret in CI logs and scrollback.

Values that must not appear there, and where they belong instead:

| Value | Belongs in |
|---|---|
| Vercel deployment credentials | `vercel login` (the CLI's own store), or the project's Environment Variables in the Vercel dashboard. The local `vercel dev` flow is not used. |
| Local development values | the root `.env.local`, which this suite never reads |

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

`bun run test` (repo root) includes `e2e:test`, which runs `target.test.ts` and
`app-env.test.ts`: it proves each refusal (no `E2E_TARGET`, unknown
`E2E_TARGET`, missing env file, a target resolving to production, a credential
in the app directory) and that the root `.env.local` is never a source. It
needs no database and no secrets.

`app-env.test.ts` ends with two tests against the **real** repository, and they
are the ones that matter: the real `apps/web` must contain no violation, and a
real process spawned with the real child environment in the real app directory
must not inherit a production credential. The first fails if
`apps/web/.env.local` ever comes back.

`tests/web-process-env.spec.ts` repeats that check against the live `next start`
during a real run (via `lsof` + `ps eww`), so a leak introduced by any other
route is caught at runtime rather than only in review. It fails rather than
skips when the process cannot be found.

```sh
bunx nx run e2e:test
```
