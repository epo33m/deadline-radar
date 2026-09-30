# Playwright CLI — mandatory usage standard

> **Status: MANDATORY.** Every E2E task in this repo — new specs, failure
> diagnosis, manual verification — goes through this tool where a browser is
> involved. Review may reject E2E work without CLI evidence. The suite of
> record stays `playwright test` (`@playwright/test` 1.63.0); a CLI-green
> manual pass never substitutes a suite run.

## Install

Pinned local install (reproducible, no global needed):

```sh
# already in apps/e2e devDependencies — this is the record, not a re-run:
bun add -d --exact @playwright/cli@0.1.22
bunx playwright-cli --help
```

Per-machine browser setup (one-time, ~280 MB — the CLI daemon requires the
full `chrome-for-testing` build; `--only-shell` is NOT sufficient, verified):

```sh
bunx playwright-cli install-browser chromium
```

Run everything below from the repo root via `bunx playwright-cli` so the
pinned version resolves, never a global install.

## Version-skew rule

`@playwright/cli` bundles its own Playwright core (1.64.0-alpha at the time of
writing) and its own Chromium revision (1247; the suite uses 1.63.0 / 1243).
Consequences, non-negotiable:

- The CLI is for **exploration, prototyping, and debugging only**. Behavioral
  differences between revisions are real (this already bit once: the CLI
  defaults to `--browser=chrome`, which is not installed here — always pass
  `--browser=chromium` explicitly).
- Anything asserted must be asserted by the suite. A CLI session that "looks
  fine" proves nothing committable.

## Rules per E2E test type

### `*.e2e.spec.ts` — browser specs (MUST)

- A new browser spec MUST be prototyped in the CLI first: `recording-start`,
  drive the flow, `recording-stop` — or snapshot-driven
  (`snapshot` → `find` → `click`/`fill`) exploration. Attach the recording or
  the snapshot trail in the PR.
- Committed locators MUST be role-based. `generate-locator` is a discovery
  aid, not a verdict: if it yields CSS/XPath soup, keep exploring until a
  role/name locator exists (if none exists, that is a product accessibility
  finding — file it instead of committing the soup).
- Every E2E failure MUST be reproduced in the CLI before fixing:
  `snapshot`, `console --level error`, `requests`. The diagnosis (not just the
  fix) goes in the issue/PR. This is how #58–#62 were worked; it is the norm.
- Manual exploratory passes MUST use a named session (`-s=<task>`), headless
  by default (`--headed` only for watched runs), and MUST end with `close`
  (plus `delete-data` when the session held a staging login).

### `*.http.spec.ts` — API specs (CLI does not apply)

There is no browser here and no amount of CLI measures one. Honesty clause:
do not perform CLI theater for these. Reproduce with `curl` or a script, same
as today.

### `smoke.spec.ts`, `web-process-env.spec.ts` (CLI for debugging only)

- Smoke failures: reproduce the failing step against the staging stack with
  `open` + `console` + `requests` before touching product code.
- `web-process-env`: no CLI involvement (process introspection by design).

### `scripts/diagnose-*.ts` diagnostic loops (CLI complements, never replaces)

One-off CLI checks (`open`, `snapshot`, `console`) are the fastest way to
confirm a symptom; the moment a check needs repeating, it becomes a script or
a spec. A CLI session transcript is not a regression test.

## Target discipline (mirrors #56 — no exceptions)

- Drive loopback staging only: `http://127.0.0.1:3025` (web),
  `http://127.0.0.1:4025` (API), or hosts from an explicit `E2E_TARGET`.
- NEVER production. The deny-list is `deadline-radar-web.vercel.app`,
  `deadline-radar-api-production.up.railway.app`, and the production Supabase
  project ref — see `PRODUCTION_MARKERS` in `apps/e2e/target.ts`. A CLI
  session pointed at any of these is a security incident, not a shortcut.

## Secrets and output hygiene

- Staging test credentials (`*-runTag@example.test` style) are the only
  secrets that may touch a CLI-driven page. Production credentials never do.
- CLI output (snapshots, console logs, screenshots, videos) lands in
  `.playwright-cli/` relative to cwd by default — pass an explicit output
  location under gitignored temp, or delete the directory afterwards. Verified
  2026-09-30: a plain `open` already wrote snapshots + a console log there.
- NEVER `state-save` a session holding credentials into the repo. Ephemeral
  sessions (`close-all` when done) are the default; `--persistent` profiles
  live outside the repo if ever needed.

## Cheat-sheet (repo-specific)

```sh
bunx playwright-cli -s=journey open --browser=chromium http://127.0.0.1:3025/login
bunx playwright-cli -s=journey snapshot
bunx playwright-cli -s=journey find "Create account"
bunx playwright-cli -s=journey fill e12 "journey-x@example.test"
bunx playwright-cli -s=journey console error
bunx playwright-cli -s=journey requests
bunx playwright-cli -s=journey recording-start
# ... drive the flow ...
bunx playwright-cli -s=journey recording-stop
bunx playwright-cli -s=journey close
bunx playwright-cli close-all
```

`show` opens the session dashboard for watched runs. `route` mocks network
requests for what-if probing (never committed as evidence of real behavior).
