# Branching & CI/CD — Deadline Radar

> Source of truth for branch flow, CI, and deploy. Migrated to trunk-based
> on 2026-10-02: the `dev` branch was deleted, the default branch is now `main`.

## Branches

| Branch | Role | Default |
|---|---|---|
| `feature/*`, `fix/*`, `improvement/*` | Daily work: short branches (1–2 days max), 1 branch = 1 issue | — |
| `main` | Trunk + production/live. The only long-lived branch | ✅ default branch (origin/HEAD) |

No integration branch. Every PR targets `main` directly.

## Flow

```
feature/* ──PR──▶ main ──▶ production
               ▲
          ci-main (full gate, required check)
          staging migrated per PR (pre-merge verification)
          Production (approval)
```

No Vercel Preview. Non-`main` deployments are disabled in the repo
(`apps/web/vercel.json`), so the only Vercel deployment is production
from `main`.

1. Start fresh: `git checkout main && git pull && git checkout -b fix/<issue>-<name>`.
   Sync daily inside the branch (`git fetch origin && git rebase origin/main`)
   so conflicts stay small instead of exploding at merge time.
2. Open a PR to `main`. `CI (feature)` (lint, typecheck,
   test, build — no database, no secrets) must be green.
   `packages/db` splits its suite: `test` (DB-free unit tests, including
   the meta-test locking the split) runs in feature CI; `test:db` (live
   database guards) only runs in ci-main after migrations (#69).
3. `deploy-staging.yml` runs automatically on every PR to `main` (and every
   `main` push, idempotent): it migrates the **staging** database so changes
   can be verified **before** merge. No Vercel Preview — see
   "Vercel project" below.
4. `ci-main` (full gate: fresh-DB migration,
   11 SQL regression files, drift, lint, typecheck, test, build) must be green.
5. Merge to `main` → `deploy-production.yml` (owner approval needed) +
   Vercel **Production** deployment. Then the manual checklist
   `docs/PROD_ENV_CHECKLIST.md` + `supabase/verify-prod.sql`.
6. Delete the head branch after merge. Tag every release (`vX.Y.Z`, targeting `main`).
   `package.json` (root + all `apps/*/packages/*` workspaces) must match
   the tag version (without the `v` prefix). Guard: `bun run check:version`
   (workspace consistency, runs in feature CI); before publishing a tag run
   `bun run scripts/check-version-sync.ts --tag vX.Y.Z`. See
   `docs/RELEASE.md` for the checklist and the GitHub Release anatomy.

## Feature vs production split

| Aspect | feature branch | main / production |
|---|---|---|
| CI | `ci-dev.yml` ("CI (feature)", light) | `ci-main.yml` (full gate, required check) |
| Vercel | no deployments (`git.deploymentEnabled` = false) | Production deployment from `deadline-radar-web` only |
| DB deploy | automatic staging on every PR to `main` | production only from `main` + approval |
| Secrets | staging (`STAGING_DATABASE_URL`) | production (`PRODUCTION_DATABASE_URL`, only read by `deploy-production.yml`) |
| E2E Playwright | manual vs staging | manual pre-release |

No workflow triggered from a feature branch reads production
secrets — that is what keeps daily work fully cut off from production.

## Vercel project

Only one Vercel project is in use:

| Project | Root Directory | Used for |
|---|---|---|
| `deadline-radar-web` | `apps/web` | Next.js web — the only project that deploys |
| `deadline-radar` | `.` (repo root) | **no longer used**, already `git disconnect`ed |

`apps/web/vercel.json` belongs to the `deadline-radar-web` project, because Vercel reads
`vercel.json` from the project Root Directory. Two things live there:

- `buildCommand: "next build"` — overrides the Build Command in Project Settings.
  The dashboard value pointed at `apps/web/scripts/verify-routes.ts` and
  `apps/web/scripts/build-csp-hashes.ts`, which never existed in the repo, so
  every deployment failed. The build command here is exactly the same as the
  `build` script in `apps/web/package.json`; `apps/web/vercel.test.ts` locks
  both so they cannot drift apart.
- `git.deploymentEnabled` — only `main` deploys (`dev: false`
  is kept explicit so that name can never deploy if recreated).
  Vercel cannot disable per-branch bot comments, so non-`main` deployments
  are killed at the source. If `main` is removed here, merges stay green but
  production never deploys — that is why `vercel.test.ts` exists.

  Note: the `productionBranch` on this project is actually **unset** (the API
  returns empty), even though `docs/BRANCHING.md` once named `main`.
  What holds in practice: deployments from `main` are marked `target=production`
  (verified — the last successful build `2a9da2f` was the `main` tip), so
  production behavior does not depend on that setting and it is not changed
  in this PR.

`deadline-radar` (root `.`) builds the monorepo from the root and always fails with
`No Output Directory named "public"`; the last 20 deployments all errored.
The production API runs on Railway, so that project is not needed.
`vercel project rm` is not run: `git disconnect` already stops its builds
and comments, and deleting a project cannot be undone.

## Manual setup that cannot be automated (GitHub Settings)

The repo is private without Pro, so the following steps are done once by a human
in Settings → Branches / Environments. Status as of 2026-10-02
(post trunk-based migration):

- [x] Environment `staging`: created via API.
- [x] Environment `Production` → deployment branches = `main` only: set
  via API (custom branch policy `main`).
- [x] Default branch = `main` (was `dev`; `dev` deleted 2026-10-02).
- [ ] Protection `main`: require PR, require green `ci-main`, 1 review,
  block force-push — needs Pro / public repo, manual click only
  (API returns 403).
- [ ] Environment `Production` → required reviewer = owner — needs
  a paid plan (API: 422 billing plan), manual click only; without
  it, prod approval relies on `main` branch protection + PR review.
