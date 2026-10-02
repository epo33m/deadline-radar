# ADR-0001: Accept bounded overshoot of the task creation quota

- Status: Accepted
- Date: 2026-10-02
- Issue: #104 (audit finding F-03, downgraded P1→P2 in second-pass review)

## Context

`POST /api/v1/tasks` enforces `MAX_ACTIVE_TASKS_PER_USER` (200, SEC-003) with
a `SELECT count()` followed by an `INSERT` as two auto-commit statements
(`apps/api/src/routes/tasks.ts`). Two concurrent distinct-key requests with
one quota slot left can both pass the check and overshoot the limit. There is
no DB-level enforcement (`packages/db/src/schema.ts`: PK + FK + list indexes
only, no partial-count constraint).

## Decision

Accept the overshoot. Do NOT add a per-user lock, `SELECT … FOR UPDATE`, or
trigger/constraint for this limit.

## Bounds (why this is safe)

- The race window is narrow: web clients send `Idempotency-Key` covering
  same-form retries, so the common duplicate-submit case never reaches the
  race; coarse rate limiting bounds raw concurrency.
- The quota is a **soft limit** (200 active tasks): an overshoot of a handful
  of rows degrades nothing — no invariant, billing, or correctness property
  depends on the exact count.
- Email-cost blast radius stays bounded by independent layers: the cron
  per-user per-run send cap (`MAX_EMAILS_PER_USER_PER_RUN`) bounds spend
  regardless of task count, and excess deliveries stay `pending` (never
  `failed`).
- Error precedence is untouched: validation → ownership → quota.

## Considered and rejected

- **Per-user advisory lock / `SELECT … FOR UPDATE` on the user row inside a
  tx** (consistent with the existing `FOR UPDATE` at `tasks.ts:748`, which
  locks a task row in the threshold path): serializes every task create on
  one lock for the hottest write path, adding contention and a new deadlock
  surface to protect a soft limit. Rejected on cost/benefit for a P2.
- **Partial unique constraint / trigger**: heavy DB machinery for a limit
  the product treats as advisory. Rejected for the same reason.

## Consequences

- No code change; no new failure mode; no contention added.
- `tasks.quota.test.ts` continues to guard the single-request behavior
  (429 at quota, 200 below) and precedence.

## Revisit when

- The quota becomes a hard limit (billing, fairness, or capacity depends on
  the exact count), or
- a real overshoot incident is observed (duplicate tasks from distinct keys
  at the quota edge), or
- per-user create concurrency grows enough that the window stops being
  narrow (re-measure first; do not lock speculatively).
