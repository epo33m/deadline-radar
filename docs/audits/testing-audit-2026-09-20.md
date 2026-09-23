# Testing Audit — Deadline Radar

> **Mode:** Full Suite Audit (static, read-only audit; no code executed by auditor except via sub-agent reads)
> **Date:** 2026-09-20
> **Repo:** `/Users/voldys/project/deadline-radar` (working tree)

## 1. Scope Summary

**Audited:** Full repo — 84 test files (`bun test` + Playwright + `psql` scripts).

**Stack:** Nx + Bun workspaces; Next.js 16 App Router (`apps/web` :3025); Elysia on Bun (`apps/api` :4025); TypeScript strict; Zod `packages/validation`; Drizzle `packages/db`; Supabase Postgres + Auth + Storage; Resend email; scheduler = external hit on `GET /api/cron/evaluate-reminders` (≥hourly).

**Test tooling:** `bun test` everywhere (`api: bun test src`, `web: bun test`, `db/domain/validation: bun test src`); Playwright 1.63 (`apps/e2e`); raw `psql -v ON_ERROR_STOP=1` SQL regression scripts (`supabase/tests/`); no coverage tool, no mutation tool, no retry/snapshot config.

**Layers present:** Unit (strong) / API via in-process `app.handle` (strong, mocked DB) / DB SQL scripts (medium) / HTTP characterization (thin) / browser E2E (1 spec) / contract (OpenAPI coverage test) / no load/security-fuzz suite.

**Critical behaviors (from `docs/product.md` + sign-off):** per-user isolation; auth session lifecycle; task/course CRUD ownership; default H-7/H-3/H-1/H-0 thresholds + dedup + no-resend + stop-on-done; hourly cron evaluation + email+in-app delivery + retry + quota; attachments; summary/calendar.

**Tenancy:** multi-user, per-`user_id` columns + Supabase RLS (`auth.uid()`), 12 tables RLS-enabled, 18 policies.

**Time features:** threshold fire-time with TZ (`Asia/Makassar` default), cutoff, batching, stale-lease reclaim, blackout alert, retry cap 3.

**CI:** single job `verify` in `.github/workflows/ci.yml` — bootstrap DB → `supabase migration up` → `migrate.ts status+verify` → 7 SQL scripts → `verify-schema-drift.ts` → `bun run lint` → `bun run test` → `bun run build`. No `continue-on-error`, but see T9 gaps.

**Assumptions / missing inputs:** no coverage report exists (none configured); no CI history/flake data; no staging/prod; tests were not executed (static audit); `docs/audits/reminder-system-audit-2026-09-20.md` and `SECURITY_SIGNOFF_2026-09-20.md` taken as stated. Anything requiring runtime (flakiness, real latency, Supabase behavior) is marked accordingly.

## 2. Executive Summary

This is a stronger-than-average suite with an honest character: reminder idempotency/concurrency/retry/quota edge cases are tested at three layers, auth negatives are broad, cross-user IDOR is tested per resource at the app layer, and the OpenAPI surface is locked to the router. The 1875-line `run-evaluate.test.ts` plus `evaluate.test.ts` (748 lines) plus `scheduler_state_test.sql` is the best part of the repo.

Trust breaks at exactly two structural points. First, **no `bun` test exercises RLS as the end-user role** — every route test mocks `getDb`/Supabase, and the only RLS proofs are metadata checks (RLS flag + policy name exists) plus manual `psql` scripts outside the `bun` graph. A dropped policy would keep every `bun` test green. Second, **there is no blocking typecheck and lint is `echo 'no lint'` for 4 of 5 workspaces** — `bun build` is transpile-only, so type errors in `api/domain/validation/db` cannot fail CI. Add the known residual from the repo's own sign-off (SEC-003 direct-PostgREST quota bypass, PARTIALLY-FIXED) and DST trigger coverage, and sign-off should be conditional, not clean.

## 3. Trust Score

| Layer | Execution coverage | Behavioral coverage | Verdict |
|---|---|---|---|
| Unit (domain/validation/pure) | High (~30 files) | Strong | Rules tested with real assertions; can fail. |
| Integration/API (`app.handle`, mocked DB) | High (~40 files) | Partial-Strong | HTTP+middleware+validation real; queries/RLS/tx never run. |
| DB/RLS | Medium (7 SQL + drift) | Superficial | Metadata + manual scripts only; no bun-level enforcement test. |
| Jobs/reminders | High | Strong except DST + calendar edges | Best-in-repo; dedup/retry/quota/overlap proven. |
| E2E/critical journeys | Low (2 specs) | Absent-Partial | 1 browser + 1 HTTP characterization; happy-path journeys not locked. |
| CI gates | — | Partial | Migration/drift/SQL/test/build real; typecheck absent, lint hollow. |

Headline distinction: **execution is broad; behavior is proven everywhere except the two places that cause catastrophic loss (tenant isolation at the DB layer, type safety in CI).**

## 4. Risk Snapshot

- Critical: 1 (RLS enforcement false assurance)
- High: 3 findings / 4 items (no typecheck gate; lint hollow; SEC-003 PostgREST bypass; DST triggers)
- Medium: 4 (403 matrix holes + route-level JWT edge cases; pagination traversal; `withUserRls` untested; E2E journeys advisory)
- Low/Info: 2 (bare-status asserts; no coverage gate)
- **Biggest untested risk right now:** a dropped or `WITH CHECK`-missing RLS policy exposes another user's tasks with zero `bun` test failures.

## 5. Behavior ↔ Test Coverage Matrix

| Behavior | Test | Verdict |
|---|---|---|
| Register/login/refresh/logout/logout-all/forgot/reset/change | `auth.routes.test.ts` (40+ `app.handle`), `auth-security`, `auth-tokens-jwks`, `auth-timeout` | Covered |
| Unauthenticated 401 / unauthorized 403 | `authorization.routes.test.ts:161-191,213-247`, `cron-auth`, `summary`, `time-format` | Covered (matrix holes → F-3) |
| Cross-user IDOR (courses/tasks/attachments/notifications/signed-URL) | `authorization.routes:193-211,263-302,441-526`, `ownership-mutation:308-407`, `courses.patch:263-277`, `notifications.read-single:130-142` | Covered at app layer; NOT at RLS layer → F-1 |
| Mass-assignment (`isAdmin`/`userId`/`role`/`deleted_at`) | Zod `.strict()` + `authorization.routes:230-247,304-339,554-574` | Covered (implicit for tenant fields) |
| RLS enabled + per-op policy enforcement as `authenticated` | `schema-drift.test.ts:32-62` (metadata only) + `supabase/tests/*.sql` (manual) | **Gap → F-1** |
| Threshold fire-time, TZ rendering, edit-guard, cutoff, terminal-done | `evaluate.test.ts`, `run-evaluate F-01/F-03/F-07/F-08`, `tasks.terminal-done` | Covered |
| Dedup/exactly-once, overlap/stale-lease, retry cap, batching, quota, ledger, failure context | `run-evaluate G1/G2/G3/M-4/M-5/M-12/SEC-003/F-04/F-05/F-09/F-12`, `scheduler_state_test.sql` | Covered |
| DST spring-forward/fall-back trigger | None (only `summary.test.ts:115-133` buckets) | **Gap → F-2** |
| Cron auth (constant-time, no leak, bypass contract) | `cron-auth.test.ts:112-169` | Covered |
| Blackout alert / idle quiet | `reminder-alert.test.ts`, `cron-blackout.test.ts` | Covered |
| Validation per-rule violation | `packages/validation/*.test.ts` + route 400s | Covered |
| Status codes 400/401/403/404/409 + error envelope | Precise asserts mostly; some bare-status | Covered (minor weakness → F-6) |
| Pagination/filter/sort traversal via query params | Unit only (`pagination.test.ts`, `api.contract.test.ts`); route only rejects bad input | **Gap → F-4 (renumbered F-6 in detail below)** |
| OpenAPI surface vs router | `openapi-coverage.test.ts` A–E | Covered |
| Migrations applied + drift zero | CI `migration up` + `migrate.ts status/verify` + `verify-schema-drift.ts` + `schema-drift.test.ts` | Covered |
| Typecheck / lint blocking | No `tsc` target; `lint: echo 'no lint'` ×4 | **Gap → F-5** |
| E2E critical journeys | `link-attachment.e2e.spec.ts` + `link-validation.http.spec.ts` only; not in `verify` job | **Gap → F-7** |

## 6. ✅ Already Covered (do not break)

- **T5 reminders:** deterministic idempotency key (`run-evaluate.test.ts:697-743`), concurrent create/retry/sweep (`749-862`), route-level overlap (`868-892`), transient-500 3× retry + containment (`898-966`), threshold mutation M-4 (`972-1096`), retry cap lifecycle (`1102-1233`), batching (`1240-1441`), app quota 50/run (`1443-1483`), cutoff (`1489-1525`), ledger (`1531-1587`), `lastError` truncation (`1593-1679`), Makassar GMT+8 rendering (`1685-1711`), completion race fail-open (`1717-1758`), `sentAt` confirmation stamp (`1764-1794`), NaN-deadline guard (`1800-1844`), email normalization (`1850-1874`); pure `isThresholdDue`/`evaluateReminders` truth tables (`domain/evaluate.test.ts:10-242,392-565`); DB arbitration (`scheduler_state_test.sql` PASS A–D); provider policy (`email-resilience.test.ts:82-242`); blackout (`reminder-alert`, `cron-blackout`).
- **T3/T4 app-layer:** 401s (anon courses, refresh-no-cookie, bad cron, tampered bearer, hanging provider), 403s (missing cap, non-admin assign, injection-still-403, signed-URL), cross-user 404s with zero-mutation asserts, recovery-`amr` + real expired-JWT pair (`auth.routes.test.ts:771-851`), JWKS tamper/unknown-kid/aud units, bridge exact-match, throttle/Redis units.
- **T2 contract:** OpenAPI A–E (`openapi-coverage.test.ts`), error envelope/cursor (`api.contract.test.ts`), pagination clamp/round-trip/invalid (`pagination.test.ts`), per-field Zod violations, 409s (threshold unique, upload conflict, stale `updatedAt`, terminal-done).
- **T9 migrations:** fresh-DB `migration up` + `status`/`verify` + 7 `psql ON_ERROR_STOP=1` scripts + drift verifier all blocking in CI.
- **T10 health:** zero `.only/.skip/xit`, zero snapshots, zero retry config; single 250 ms `setTimeout` is a deliberate provider-delay discriminator (`run-evaluate.test.ts:1783-1794`), not flake.

## 7. ⚠️ Findings

### [F-1] No bun test enforces RLS as the end-user role — metadata checks cannot fail on policy drop

**Severity:** Critical
**Status:** 🔴 Must Fix
**Dimension:** T4
**Layer:** DB/RLS
**Location:** `supabase/migrations/20260901*.sql` + `packages/db/src/schema-drift.test.ts:32-62` → **no test found** (bun-level row-visibility probe)
**Confidence:** Confirmed

**What is untested (or falsely assured)**
Every `bun` route test mocks `getDb`/`createAnon/UserClient` (`authorization.routes.test.ts:47-73`, `ownership-mutation.test.ts:91-98`). `schema-drift.test.ts:48-49` asserts `rlsEnabled==12` + 18 policy names exist — it passes if a policy's `USING`/`WITH CHECK` is wrong, if `DELETE` is accidentally allowed, if a new table ships without RLS (until contract updated), or if a `SECURITY DEFINER` view bypasses. Only `supabase/tests/*.sql` (`SET ROLE authenticated`) probes rows, and those are manual `psql` scripts, not `bun` assertions in the dev loop.

**Evidence**
```ts
// packages/db/src/schema-drift.test.ts:48-49 — passes with a wrong policy body
expect(rlsEnabledTables).toBe(12); expect(policies).toBe(18);
// vs what is missing: no `SET ROLE authenticated; SELECT * FROM tasks` as user A expecting 0 rows of user B
```
Why it cannot fail: drop `tasks` SELECT policy's `auth.uid()=user_id` predicate — all 84 `bun` tests still pass; only a human running `psql supabase/tests/` notices.

**Bug this would let through**
Tenant A lists/reads tenant B tasks via a policy regression or a new `reporting_view` with `SECURITY DEFINER`; blast radius all tenants; monitoring unlikely to catch.

**Required tests**
1. `rls tasks SELECT isolates tenants` — as `authenticated` A, `SELECT` returns only A rows; B rows invisible; assert count.
2. `rls tasks INSERT WITH CHECK blocks cross-tenant write` — A inserting `user_id=B` fails; assert error + row count unchanged.
3. `rls is enabled on every tenant table` — query `pg_tables` for `rowsecurity`, assert set equals tenant-table list (fails when a table is added without RLS).
4. Per-op matrix for `courses/tasks/thresholds/deliveries/attachments/profiles` (S/I/U/D allow+deny, incl. `courses DELETE must fail`, zero-policy tables deny `authenticated`).

**Systemic fix**
`supabase/tests/rls_matrix.sql` run inside `bun test` (or asserted in CI `psql` step with `ON_ERROR_STOP=1` + explicit negative cases), plus a `withUserRls` integration test (see F-3).

**Effort:** Medium **Priority:** P0

### [F-2] DST trigger transitions untested despite bespoke DST-settle code

**Severity:** High
**Status:** 🔴 Must Fix
**Dimension:** T5
**Layer:** Unit (domain)
**Location:** `packages/domain/src/evaluate.ts:37,71` (`fromZonedTime` 3-iteration settle) → `packages/domain/src/evaluate.test.ts` (no DST-observing zone)
**Confidence:** Confirmed

**What is untested (or falsely assured)**
`evaluate.test.ts:11-13` covers `Asia/Makassar` (no DST ever) only. No spring-forward gap (nonexistent local time) or fall-back overlap (ambiguous, fires twice/never) for `thresholdTriggerAt`/`isThresholdDue` in e.g. `America/New_York`/`Australia/Sydney`. Only DST test is unrelated bucketing (`summary.test.ts:115-133`).

**Evidence**
```ts
// no fake-timer API anywhere: grep useFakeTimers|setSystemTime → No files found
// TZ vectors use fixed Makassar instants, e.g. evaluate.test.ts:16:
new Date("2026-09-08T15:58:59.000Z") // Asia/Makassar H-3 boundary
// never 2026-03-08T02:30 America/New_York (gap) or 2026-11-01T01:30 (overlap)
```
Why it cannot fail: break the settle loop (single-pass offset) — every test still passes; reminders fire an hour early/late for DST users twice a year.

**Bug this would let through**
H-1/H-0 email fires at wrong wall-clock hour or duplicates on fall-back Sunday; blast radius per-DST-zone users; low detectability.

**Required tests**
1. `spring-forward gap resolves forward` — H-1 on gapped local time fires at defined instant, assert exact UTC.
2. `fall-back overlap fires once` — threshold in overlap produces exactly 1 delivery across two runs.
3. `non-UTC offset preserved across DST boundary` — H-3 date arithmetic stable.

**Systemic fix**
Mandate one DST-observing zone vector per time function; the repo's own `docs/audits/reminder-system-audit-2026-09-20.md:214,231` already flags this — close it.

**Effort:** Small **Priority:** P0

### [F-3] Authorization 403 matrix + route-level JWT edges incomplete; `withUserRls` dead code

**Severity:** High
**Status:** 🔴 Must Fix
**Dimension:** T3/T4
**Layer:** API/Unit
**Location:** `apps/api/src/lib/authorization/rls-context.ts:15-39` (zero `*.test.ts` callers) → `authorization.routes.test.ts:213-247` (only `role.assign` 403)
**Confidence:** Confirmed

**What is untested (or falsely assured)**
403 proven for `role.assign` + signed-URL + missing-cap generic, but not for `role.revoke`, `audit.view`, or per-capability `task.*`/`attachment.delete`/`notification.*`. Route-level JWT edges: expired/malformed only on `reset-password` (`auth.routes.test.ts:771-810`); no `alg:none`/RS-vs-HS confusion or `aud`/`iss` mismatch at route level (only JWKS units). `withUserRls` GUC-set + empty-`userId` throw (`rls-context.ts:19-21`) untested.

**Evidence**
```ts
// decide.ts:14 has resource_not_owned in union but never returned —
// ownership enforced ad hoc in ownership.ts, no central test.
// grep withUserRls *.test.ts → 0 hits
```
Why it cannot fail: expose `role.revoke` without cap check — no test asserts 403 there; leak GUC across tx — no test observes `current_setting`.

**Bug this would let through**
Privilege escalation on untested admin op; session-context leak across requests in pooled tx; blast radius single tenant → platform.

**Required tests**
1. `non-admin role.revoke → 403` + `non-admin audit.view → 403` (mirror existing assign test).
2. `expired bearer on GET /courses → 401` (reuse real `SignJWT` pattern from reset test).
3. `withUserRls sets sub+role claims and clears on release; empty userId throws` — assert `current_setting` inside/outside tx.

**Systemic fix**
Role-matrix table test (roles × resources × verbs) instead of one-off asserts.

**Effort:** Small-Medium **Priority:** P1 (P0 for `withUserRls` if it ships in request path)

### [F-4] SEC-003 residual: direct-PostgREST INSERT bypasses app quota — tested at app, open at DB

**Severity:** High
**Status:** 🔴 Must Fix
**Dimension:** T2/T4
**Layer:** DB/RLS
**Location:** `apps/api/src/services/run-evaluate.test.ts:1444-1481` (app quota 50/run proven) vs `docs/PROD_ENV_CHECKLIST.md:92` gate C4 OPEN
**Confidence:** Confirmed (per the repo's own `SECURITY_SIGNOFF_2026-09-20.md §4`: "jalur app tertutup, jalur PostgREST langsung terbuka")

**What is untested (or falsely assured)**
App-layer quota is well tested; DB-layer guard (RLS policy / trigger / quota table blocking direct `notification_deliveries` INSERT) has no test because the guard does not exist yet. `run-evaluate` quota never sees a direct write.

**Evidence**
```ts
// run-evaluate.test.ts:1467-1481 — 60 due → 50 sent, 10 pending+skipped, never failed
expect(result.emailsSkippedQuota).toBe(10);
// Nothing equivalent exists for: INSERT INTO notification_deliveries (...) as authenticated
```

**Bug this would let through**
Authenticated user spams `notification_deliveries` via PostgREST → email amplification; blast radius platform (Resend quota/cost).

**Required tests**
1. `direct INSERT beyond quota fails` — as `authenticated`, Nth delivery INSERT rejected; assert error + count capped.
2. `service_role path intentional and scoped` — assert which key bypasses and that anon cannot.

**Systemic fix**
Close C4 per `PROD_ENV_CHECKLIST.md §7` (policy/trigger), then lock with the above test. Do not sign prod until then.

**Effort:** Medium **Priority:** P0 (prod blocker; not a dev-loop blocker)

### [F-5] No blocking typecheck; lint is hollow for 4/5 workspaces

**Severity:** High
**Status:** 🔴 Must Fix
**Dimension:** T9
**Layer:** CI
**Location:** `.github/workflows/ci.yml:84-91` (lint→test→build, no `tsc`) + `apps/api/package.json:11`, `packages/{db,domain,validation}/package.json` (`"lint": "echo 'no lint'"`)
**Confidence:** Confirmed

**What is untested (or falsely assured)**
`bun build src/index.ts` is transpile-only (never typechecks). No `tsc --noEmit` target exists (`grep tsc|typecheck → 0 hits`). Only `apps/web` gets incidental checking via `next build`. `strict:true` in `tsconfig.base.json` is unenforced for API/packages; `noUncheckedIndexedAccess` etc. absent (weakening, not a finding alone).

**Evidence**
```json
// apps/api/package.json:9 + :11
"build": "bun build src/index.ts --outdir dist --target bun",
"lint": "echo 'no lint'"
```
Why it cannot fail: introduce a type error in `apps/api/src/lib/authorization/guard.ts` — CI stays green.

**Bug this would let through**
Shipped type-unsound authz/reminder code; blast radius any.

**Required tests (gates)**
Add `typecheck: tsc --noEmit` per workspace + `bun run typecheck` as a blocking CI step before `test`; replace `echo 'no lint'` with real eslint or an explicit skip marker so the step is honest.

**Systemic fix**
CI must run build+typecheck+lint+tests all blocking; audit `next.config.ts` for `ignoreBuildErrors` (currently absent — keep it that way).

**Effort:** Small **Priority:** P0

### [F-6] Pagination traversal + filter combos route-untested; a few bare-status asserts

**Severity:** Medium
**Status:** ⚠️ Gap
**Dimension:** T2/T6
**Layer:** API
**Location:** `apps/api/src/lib/api/pagination.test.ts:1-110` (unit) vs routes (only `?limit=100000→400`, `?sort=drop_table→400`, bad cursor→400 in `authorization.routes.test.ts:341-395`)
**Confidence:** Confirmed

**What is untested (or falsely assured)**
No route test walks `limit/cursor → nextCursor → next page` envelope or `status/search/sort` combos; `summary.routes.test.ts` filters in-memory fixtures, not via query params. Weak asserts: `courses.patch.test.ts:233,248,260` bare `toBe(400)`, `terminal-done.test.ts:161` bare `409`, `authorization.routes.test.ts:547` `not.toBe(403)`.

**Evidence**
```ts
// authorization.routes.test.ts:341-356 — rejection only, no traversal
expect(response.status).toBe(400); // ?limit=100000 / ?sort=drop_table
// missing: GET /tasks?limit=2 → nextCursor → GET /tasks?cursor=… → assert pages
```

**Bug this would let through**
Off-by-one cursor, filter ignored (returns other user's rows masked as 200 — authz bypass via listing), sort injection; blast radius single user, moderate likelihood.

**Required tests**
1. `paginates tasks limit=2 over 3 rows` — assert `nextCursor` + second page contents + empty tail.
2. `status filter + search combo` — assert exact subset via query params.
3. Tighten bare asserts to `code` + `requestId` (follow the file's own strong pattern at `:320-321`).

**Systemic fix**
Route-level pagination contract test reusing the unit cursor helpers.

**Effort:** Small **Priority:** P1

### [F-7] E2E journeys advisory-only; top revenue/trust paths not locked

**Severity:** Medium
**Status:** ⚠️ Gap
**Dimension:** T8
**Layer:** E2E
**Location:** `apps/e2e/tests/` (2 specs) + `.github/workflows/ci.yml` (no `playwright test` step)
**Confidence:** Confirmed

**What is untested (or falsely assured)**
Only `link-attachment.e2e.spec.ts` (browser) + `link-validation.http.spec.ts` (HTTP characterization vs live stack) exist. No journey for register→course→task→thresholds→cron→email+bell→read→done-stops-reminders; no calendar/summary visual; E2E not blocking in `verify` job (`pretest:e2e`/`test:e2e` scripts exist but never invoked in CI).

**Evidence**
```yaml
# .github/workflows/ci.yml:84-91 — lint → test → build; no playwright step
- name: Run Workspace Tests
  run: bun run test
- name: Build Projects
  run: bun run build
```

**Bug this would let through**
Wiring break between API contract and web `openapi-fetch` client / cookie gate (`session-gate.test.ts` is unit-only) reaches staging unnoticed.

**Required tests**
1. `auth gate journey` — anon → login → session.
2. `task lifecycle journey` — create → default thresholds created.
3. `reminder → bell read journey` — cron → notification bell read.
Run against disposable DB in CI or mark explicitly advisory.

**Systemic fix**
Either wire Playwright into CI `verify` (with disposable DB) or document E2E as explicitly non-blocking.

**Effort:** Medium **Priority:** P2

### [F-8] DB failure + concurrency beyond reminders untested

**Severity:** Medium
**Status:** ⚠️ Gap
**Dimension:** T7
**Layer:** Integration
**Location:** `apps/api/src/lib/email-resilience.test.ts` (Resend faults covered) vs DB faults (none)
**Confidence:** Confirmed

**What is untested (or falsely assured)**
Resend timeout/500/malformed/429/`409`-in-flight and Supabase hang are covered; DB constraint-violation/deadlock/connection-loss mid-transaction, unique-violation race on non-threshold paths, and fail-closed-on-throw for authz (`try/catch` swallowing deny) are not. `role-admin-tx.test.ts:283-299` covers audit-fail rollback in-memory, not a real tx.

**Evidence**
```ts
// email-resilience.test.ts:95-100 — provider faults proven, DB faults have no equivalent
expect(new Set(keys).size).toBe(1); // same Idempotency-Key across 3 retries
```

**Bug this would let through**
Partial write (task without thresholds) on mid-tx DB loss; authz fail-open on thrown check; blast radius single user, low-moderate likelihood.

**Required tests**
1. `mid-tx failure rolls back task+thresholds` — assert row counts.
2. `authz check throwing denies (fail-closed)` — stub `policyOk` to throw, expect 403 not 200.

**Systemic fix**
Fail-closed convention test for every authorization decision point.

**Effort:** Small **Priority:** P1

## 8. 🔴 Must Fix Before Sign-off

1. **F-1 RLS enforcement matrix as `authenticated`** (P0, Medium) — without this the suite cannot catch tenant leakage.
2. **F-5 blocking `tsc --noEmit` + honest lint** (P0, Small) — without this CI certifies untyped code.
3. **F-2 DST trigger vectors** (P0, Small) — 3 tests, closes known audit flag.
4. **F-4 SEC-003 DB guard + test** (P0 prod-blocker, Medium) — per `PROD_ENV_CHECKLIST.md §7`, not green `bun` tests.
5. **F-3 `withUserRls` test + revoke/audit 403s + route-level expiry** (P1, Small-Medium).

## 9. Systemic Observations

- **Mock boundary is uniform and honest but deep:** `app.handle` is real through middleware/validation; persistence is always stubbed. That buys fast authz/validation signal and zero query/transaction/RLS signal. Every integration test mocks the repository layer, so no SQL has ever run inside `bun test`.
- **Negative tests exist for validation, unevenly for authorization:** 400-matrix is excellent; 403-matrix is one-op deep.
- **Time is injected (`now: Date`), never faked:** good determinism, but DST code paths have no vectors calling them.
- **Pyramid is upright, E2E is vestigial:** ~75 unit/API tests, 7 SQL scripts, 2 e2e specs (1 non-browser). Not inverted — just missing the journey lock.
- **Coverage number would be laundering:** exclusions unreviewed, no branch gate, highest-risk files (RLS policies, `rls-context.ts`) at 0% behavioral coverage regardless of line %.

## 10. Remediation Roadmap

- **Immediate (P0 — block release):** F-1 RLS matrix; F-5 typecheck+lint gates; F-2 DST vectors; F-4 C4 DB guard (prod deploy blocked until then per checklist §7).
- **Short term (this sprint):** F-3 revoke/audit 403s + JWT route edges + `withUserRls`; F-8 rollback/fail-closed; F-6 pagination traversal + tighten bare asserts.
- **Medium term (this quarter):** F-7 three blocking E2E journeys; per-route response-shape schema asserts (Zod/JSON Schema) to catch contract drift; N+1/perf budget on list endpoints.
- **Structural:** `supabase/tests/rls_matrix.sql` wired into `bun test` or CI `psql` with negative cases; role-matrix table test helper; `tsc --noEmit` in `nx run-many`; forbid `echo 'no lint'`; DST-zone vector convention; mutation-testing run on `guard.ts`/`decide.ts`/`ownership.ts`/`evaluate.ts`.

## 11. Suggested Test Additions (prioritized backlog)

1. `rls/tasks-select-isolates-tenants` — A sees only A; assert counts.
2. `rls/tasks-insert-with-check-blocks-cross-tenant` — A→B `user_id` fails.
3. `rls/enabled-on-all-tenant-tables` — assert over `pg_tables`.
4. `rls/per-op-matrix` — S/I/U/D per table incl. `courses DELETE must fail`.
5. `typecheck/api-packages-blocking` — CI gate (not a test file; highest ROI).
6. `reminders/dst-spring-forward-gap` + `fall-back-overlap-fires-once`.
7. `cron/direct-insert-quota-denied` (after C4 guard built).
8. `authz/role-revoke-403` + `audit-view-403` + `expired-bearer-on-courses-401`.
9. `rls-context/sets-and-clears-guc` + `empty-userid-throws`.
10. `tasks/paginates-limit-cursor` + `status-search-combo`.
11. `tx/mid-failure-rolls-back` + `authz-throw-fails-closed`.
12. `e2e/task-lifecycle-journey` + `reminder-to-bell-journey` + `auth-gate-journey`.

## 12. Coverage Gaps of This Audit

Static only: tests were not executed, so real flakiness, runtime, wall-clock behavior, and Supabase/Resend live faults are unverified. No coverage tool output to recompute; branch coverage inferred from reads. No CI history to confirm blocking-ness beyond YAML. No prod data shapes. Recommend: full `bun run test` + `tsc --noEmit` run, mutation run on `authorization/*` + `evaluate.ts`, flake-rate report if CI history exists, and a staging soak for cron overlap + DST clock-shift before release.

## 13. Verdict

No formal Go (not a release sign-off request; prod does not exist yet and independence is limited). Assessment: **Conditional — do not treat green `bun test` as proof of tenant isolation or type safety until F-1, F-5, F-2, and C4/F-4 are closed.** The reminder engine itself is the most trustworthy part; the DB boundary and the pipeline gates are the least.

---

## Rapid Triage Checklist (evidence)

**Structural**
- [x] Every module with business logic has a test file; exceptions: `rls-context.ts` (no test file), `ownership.ts` (tested indirectly only)
- [x] Coverage exclusions reviewed — no coverage tool configured; headline number n/a (laundering risk noted, not recomputed)
- [x] Branch coverage checked on critical modules — inferred from reads (reminder branches strong; RLS/policy branches absent)
- [x] Test pyramid shape assessed and stated (upright, E2E vestigial)

**Access and isolation**
- [x] Every protected endpoint has an unauthenticated-rejection test (yes, via `authorization.routes` + `cron-auth` + `summary` + `time-format`)
- [x] Every protected endpoint has an authenticated-but-unauthorized test (partial — assign covered, revoke/audit/task-caps missing → F-3)
- [x] Cross-tenant read AND write denial tested per resource (app layer yes; RLS layer no → F-1)
- [x] RLS tests confirmed to run as the end-user role, not a bypassing service role (**NO — all mocked; only manual psql uses `authenticated` → F-1**)
- [x] A test exists proving RLS is enabled on every tenant-scoped table (metadata only → F-1)
- [x] Mass-assignment / privilege-field injection tested (yes: `isAdmin`/`userId`/`role`/`deleted_at`)

**Time and jobs**
- [x] Clock is controlled in every time-dependent test — injected `now: Date`, no `useFakeTimers`, one justified 250 ms delay (no `sleep`-based waiting)
- [x] Reminder fire-time, timezone, and DST cases tested (fire-time + Makassar yes; DST no → F-2)
- [x] Duplicate-delivery and retry semantics tested (yes, three layers)
- [x] Cron/schedule registration itself asserted (auth + overlap + ledger; raw cron expression n/a — external scheduler TBD)
- [x] Jobs verified as tenant-scoped (app-layer yes via `user_id` predicates; DB RLS layer no → F-1)

**Behavior**
- [x] Negative test exists for every validation rule (yes — ratio ~1:1 in `packages/validation`)
- [x] External dependency failures simulated (Resend + Supabase hang yes; DB faults no → F-8)
- [x] Boundary values tested on every numeric, string, and collection input (strong on strings/collections via Zod; numeric overflow/NaN partial → F-6/F-8)
- [x] Error status codes and payload shapes asserted precisely (mostly; bare-status spots → F-6)
- [x] Mutation check performed on 3–5 critical rules (guard owner-check NONE-applicable; dedup-removal fails `evaluate.test.ts:113-171`; cron-secret-removal fails `cron-auth.test.ts:126-169`; quota-removal fails `run-evaluate.test.ts:1444-1481`)

**Pipeline**
- [x] Build, typecheck, lint, and tests all confirmed blocking in CI (**NO — typecheck absent, lint hollow → F-5**)
- [x] Type-suppression escapes counted and located in critical paths (no `@ts-ignore`; `as any` test-only)
- [x] Skipped / `.only` / flaky tests enumerated (zero found)
- [x] Retry configuration identified and flagged (none found)
