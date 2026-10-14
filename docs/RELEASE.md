# Release Guide — Deadline Radar

> Source of truth for how to release. Closes issue #145 (package.json vs tag drift).
> Production status: the app is live at https://dr.rapm.space — **not a demo**.

## 1. Version rules

- SemVer, tag `vX.Y.Z` targeting `main` (or a specific SHA on `main`).
- The root `package.json` **and** every workspace (`apps/*/package.json`,
  `packages/*/package.json`) must carry the same version as the tag without
  the `v` prefix. Example: tag `v1.1.0` ↔ `"version": "1.1.0"` in all 7 files.
- Guard:
  ```bash
  bun run check:version                              # workspace consistency (runs in feature CI)
  bun run scripts/check-version-sync.ts --tag vX.Y.Z # must pass before the tag is pushed / the release published
  ```

## 2. GitHub Release anatomy

Every release consists of 5 components:

1. **Version tag** — a marker pointing at one specific commit on `main`. SemVer
   format (`v1.1.0`; pre-releases `vX.Y.Z-beta.N`). Target: the `main` branch
   or a commit SHA.
2. **Release title** — short: version + main theme. Example:
   `v1.1.0 - Pagination + Telemetry`. If left empty, GitHub uses the tag name.
3. **Release notes / What's changed** — Markdown: Added / Fixed / Changed,
   related PRs and issues, comparison link `v1.0.0...v1.1.0`. Use the
   **Generate release notes** button, then tidy up following the §4 template.
4. **Release assets** — this app is web (deployed via Vercel + Railway), so
   there are no custom binaries. The automatic GitHub Source Code `.zip` /
   `.tar.gz` assets are enough.
5. **Status & publishing** — stable release: `Set as a pre-release` left
   **unchecked**, `Set as the latest release` **checked**, then **Publish
   release** (drafts are for private preparation only).

## 3. Release checklist (manual via the GitHub web UI)

1. Make sure `main` is green (ci-main) and the release branch is merged.
2. `bun run check:version` passes; bump the version first if needed (single
   `chore(release): bump to X.Y.Z` commit).
3. Create the tag: `git tag vX.Y.Z && git push origin vX.Y.Z`.
4. Verify: `bun run scripts/check-version-sync.ts --tag vX.Y.Z` passes.
5. GitHub → Releases → **Draft a new release** → pick the tag → fill in the
   title + notes (§4) → check latest, not pre-release → **Publish release**.
6. Update the version badge in `README.md` if not yet done (via follow-up PR
   if needed).

Full automation (an auto-create-release workflow firing on pushed `v*` tags)
is deliberately not added yet — this keeps the release PR metadata-only and small.

## 4. v1.1.0 — What's changed (20 commits since v1.0.0)

**Tag:** `v1.1.0` · **Target:** `main` · **Title:** `v1.1.0 - Pagination + Telemetry`
**Compare:** `v1.0.0...v1.1.0` · **Status:** latest, not a pre-release · **Assets:** automatic source.

### Added

- Cursor pagination in the task & notification lists — the API cursor is threaded
  through to the web (I-10, #156).
- Per-attempt send telemetry + `TRUST_PROXY`-aware audit IPs (I-13, #159).
- Client identity forwarded web → API for per-client rate limiting (#169).

### Fixed / Hardened

- Auth bridge: same-origin intent gate (#171); cookies cleared only on 401
  refresh (#172); fail-closed to peer when every XFF entry is trusted (#174);
  bridge body cap applied before buffering (#175).
- API: freeze the email identity before the provider call (#158); order authz
  cache invalidation against population (#170); guard `JSON.parse` against
  non-JSON (#154); Elysia PARSE errors → 400 envelope without Sentry (#153);
  body cap independent of Content-Length (#152).
- Idempotency: atomic completion + dedupe guard (#151); validate the body
  before the claim, release the key on 4xx (#150).
- Scheduler/ops: re-apply scheduling guards in the stuck-pending sweep (#149);
  self-heal rate-limit key TTL (#148); exact, age-gated storage-sweep
  referenced check (#147); auth-abuse throttle resilient to Redis timeouts +
  memory fallback (#146); revoke client EXECUTE on the `get_user_summary`
  RPC (#176); isolate web test files from Next's console patch (#157).

Copy this section as the Release notes body when publishing v1.1.0 in the GitHub web UI.
