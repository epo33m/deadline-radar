# Deadline Radar — Architecture

> **Source of truth:** `product.md` (Baseline v0.1) + `DOMAIN.md`

---

## 1. High-Level Architecture

```
┌─────────────┐        ┌──────────────────────────┐
│   Browser   │◀──────▶│  Next.js UI (apps/web)   │
│ (user)      │ :3025  │  App Router + RSC        │
└─────────────┘        └────────────┬─────────────┘
                                    │ same-origin rewrite /api/*
                                    │ httpOnly session cookies
                                    ▼
                       ┌────────────────────────┐       ┌──────────┐
                       │  Elysia API (apps/api) │──────▶│  Resend  │
                       │  Bun :4025 + OpenAPI   │       │ (email)  │
                       │  /api/v1/*             │       └──────────┘
                       └────────────┬───────────┘
                                    │
              ┌─────────────────────┼─────────────────────┐
              ▼                     ▼                     ▼
     ┌────────────────┐   ┌────────────────┐   ┌──────────────────┐
     │ Supabase Auth  │   │ Postgres       │   │ Supabase Storage │
     │ (identity)     │   │ via Drizzle    │   │ (attachments)    │
     └────────────────┘   └────────────────┘   └──────────────────┘
                                    ▲
                                    │ hourly (scheduler TBD)
                       ┌────────────────────────┐
                       │ Cron → GET /api/v1/cron│
                       │ /evaluate-reminders    │
                       └────────────────────────┘
```

## 2. Components

### 2.1 Frontend — Next.js (`apps/web`, port 3025)
UI only: pages, forms, and thin server actions that call the API over same-origin `/api/*` (Next rewrite → Elysia). Session gate uses the `dr_access_token` httpOnly cookie.

Main pages (indicative):
- `/login`, `/register`
- `/dashboard`, `/courses`, `/tasks`, `/tasks/[id]`, `/calendar`
- `/preferences`, `/preferences/notifications`
- Header bell — unread count via API

### 2.2 Backend — Elysia (`apps/api`, port 4025)
Owns **all auth, domain API, and business logic** under **`/api/v1`** (immediate cutover; no coexisting `/api` v0 aliases):
- Auth: register, login, logout, password reset, session, timezone
- CRUD + commands: courses, tasks, thresholds, attachments, notifications
- Admin: role assign/revoke, audit list
- Cron: `GET /api/v1/cron/evaluate-reminders` (Bearer `CRON_SECRET`; required except `NODE_ENV=test`)
- Unversioned: `GET /health`, OpenAPI at `/openapi`

**Request pipeline:** requestId → error handler → CORS → body limit → rate limit → http-policy → authz → Zod validation → handler → DTO serialize.

Layering: **routes (HTTP/authz/validate/serialize) → thin application services → Drizzle**. App-layer authorization via RBAC capabilities + ownership (`requireAuthz` + owned-resource helpers). Existing Postgres RLS remains defense-in-depth.

### 2.2.1 API contract (v1)

**Error envelope (all failures):**

```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Request validation failed",
    "details": [{ "field": "title", "message": "..." }]
  },
  "requestId": "uuid"
}
```

Codes include: `VALIDATION_ERROR`, `UNAUTHORIZED`, `FORBIDDEN`, `NOT_FOUND`, `CONFLICT`, `RATE_LIMITED`, `PAYLOAD_TOO_LARGE`, `DEPENDENCY_FAILURE`, `IDEMPOTENCY_CONFLICT`, `INTERNAL`. Stack traces / SQL / provider messages are never returned.

**Success collections:** `{ <resourceKey>: [...], page: { nextCursor, limit } }` with cursor/keyset pagination (default limit 50, max 100).

**Validation:** Zod in `@deadline-radar/validation` is business SSoT; request objects use `.strict()` (unknown fields rejected). Mass-assignment deny-list blocks ownership/role/system fields.

**Idempotency:** `Idempotency-Key` (8–128 chars) on create POSTs; stored in `idempotency_keys` (24h TTL); same key+body replays; different body → `409 IDEMPOTENCY_CONFLICT`.

**Optimistic concurrency:** course/task `PATCH` may include `updatedAt`; mismatch → `409 CONFLICT`.

**Versioning / deprecation:** current surface is `/api/v1`. Breaking changes require a new version path and a documented migration window. Additive fields are non-breaking. Unversioned `/api/*` domain routes are removed (no aliases).

**N/A for this product (explicit non-goals, not incomplete work):** bulk/import APIs, async job/status APIs, full-text search DSL, multi-tenant orgs.

**Operational requirements:** apply migration `20260905020000_api_contract.sql` (course `updated_at` + `idempotency_keys`) before relying on those features. Set `AUTH_BRIDGE_SECRET` on both API and web. Production boot fails closed without `AUTH_BRIDGE_SECRET` / `CRON_SECRET`. `REDIS_URL` is required for multi-node rate limits; local/dev uses in-memory by design. Optimistic concurrency (`updatedAt`) applies to course/task PATCH — the only domain resources with mutable version columns.

### 2.3 Database — Supabase Postgres + Drizzle
- DDL / triggers / RLS: `supabase/migrations/` (source of schema truth for this branch)
- Query layer: `@deadline-radar/db` (Drizzle schema mirroring `DATA-MODEL.md`)
- Privileged `DATABASE_URL` from the API for cron/admin writes. Domain ownership lookups run inside `withUserRls(userId)` transactions that set Supabase JWT claim GUCs (`request.jwt.claim.sub`) with `is_local=true` so pooled connections cannot leak identity. For Postgres RLS to enforce (not only app filters), point `DATABASE_URL` at a role **without** `BYPASSRLS`; otherwise RLS remains defense-in-depth only.

### 2.4 Storage — Supabase Storage
- Private bucket `attachments`; API uses service role for upload/signed URLs
- Path: `attachments/{user_id}/{task_id}/{filename}`

### 2.5 Email — Resend
- Reminder emails from the API cron/evaluator path

### 2.6 Scheduler
- Endpoint lives on Elysia (`/api/v1/cron/evaluate-reminders`)
- Production runner (pg_cron, external cron, host scheduler) remains **TBD** per `product.md`
- Local: `curl -H "Authorization: Bearer $CRON_SECRET" http://127.0.0.1:4025/api/v1/cron/evaluate-reminders`

## 3. Data Flow: Reminder Evaluation (per run)

1. Scheduler hits the API cron route (hourly).
2. Job loads open tasks + thresholds + deliveries via Drizzle.
3. Pure domain logic (`@deadline-radar/domain` `evaluateReminders`) decides create/retry actions.
4. Insert/update `notification_deliveries`; send email via Resend; in-app rows marked `sent`.
5. UI polls notifications via API.

## 4. Auth & Security

### Identity model
- Supabase Auth owns identity, password hashing, email confirmation, and reset tokens (email/password MVP).
- **Out of scope (deferred):** MFA/2FA, Google OAuth, magic link (`MVP.md`, issue #38).
- App auth context (`AuthUser`): `userId` (`id`), optional `email`, optional `sessionId` from JWT `session_id`. Authentication answers “who”; authorization is separate (see below).

### Authorization model (RBAC + ownership)
- **Single source of truth:** `apps/api/src/lib/authorization/` + tables `roles`, `role_capabilities`, `user_roles`.
- **Subject:** verified JWT user id. **Roles:** loaded from `user_roles` (never from client body or JWT role claims). **Capabilities:** union of `role_capabilities` for those roles; unknown capability IDs are denied.
- **Roles (seeded):** `user` (default on signup / backfill), `admin` (role assign/revoke + audit view only). **No role inheritance.** Flat capability maps only.
- **Scope:** owned resources (`resource.user_id === subject.id`). **Multi-tenant / org isolation: N/A** (B2C per-profile ownership; no org/workspace).
- **Enforcement:** domain/admin routes use `authPlugin` / `requireAuthPlugin` + per-handler `requireAuthz('<capability>')` + ownership-scoped queries. Missing capability → `403`; missing identity → `401`; cross-owner resource → `404` (anti-enumeration) except signed-URL path/row mismatches → `403`. Every protected handler must call `requireAuthz` (fail closed). Account changes require `profile.password.update` / `profile.email.update`.
- **Admin:** `POST /api/v1/admin/roles/assign|revoke`, `GET /api/v1/admin/audit`. Admin does **not** unlock cross-user course/task access.
- **Cron:** separate principal via `CRON_SECRET` (not an RBAC role). Required whenever `NODE_ENV !== test`.
- **Field-level:** mutation deny-list blocks client `userId` / `role` / `capabilities` / `deletedAt` injection; Zod `.strict()` rejects unknown keys.
- **Caching:** short-lived in-memory authz snapshot per `userId` (30s TTL). Cache keys are subject ids only (no cross-user collision). Invalidated on `role.assign` / `role.revoke`. Fail closed on load errors (empty capabilities).
- **RLS:** ownership helpers use `withUserRls` (transaction-local JWT claim GUCs). App-layer RBAC remains primary; RLS applies when `DATABASE_URL` is a non-`BYPASSRLS` role.
- **Audit:** `auth_audit_events` records auth events plus `authz.denied`, `role.assigned`, `role.revoked` (no secrets).

### Session / cookies
- Elysia sets `dr_access_token` / `dr_refresh_token` httpOnly cookies (`Secure` in production, `SameSite=lax`, `Path=/`) after login/register/confirm/refresh.
- Access lifetime ≈ Supabase `expires_in`; refresh absolute max-age 30 days. Idle timeout N/A (stateless JWT); refresh renews access.
- `POST /api/v1/auth/refresh` rotates tokens via Supabase `refreshSession`. Next `proxy.ts` silently refreshes when access JWT is invalid but refresh cookie is present.
- Logout: `POST /api/v1/auth/logout` (current session, `signOut` local) and `POST /api/v1/auth/logout-all` (global). Password reset completion clears cookies and global sign-out.
- Signed-in account changes: `POST /api/v1/auth/change-password` and `POST /api/v1/auth/change-email` verify the current password (via `signInWithPassword`) before calling Supabase `updateUser`. Password change keeps the session and rotates tokens via `refreshSession`. Email change confirms the **new address only** (Supabase setting); `GET /api/v1/auth/session` returns `pendingEmail` (`new_email`) while a change is unconfirmed.
- JWT verified via Supabase **JWKS** (ES256/RS256/EdDSA; legacy HS256 JWT secret optional fallback) on protected API routes **and** in the Next proxy.
- Invalid/expired tokens are cleared by `/api/v1/auth/session`, refresh failure, and API `401`.

### Token transport (no browser JS secrets)
- Access/refresh tokens appear in JSON **only** when the caller sends `x-dr-auth-bridge: <AUTH_BRIDGE_SECRET>` (Next server bridges for login/register/confirm/refresh/proxy). The literal value `1` is never accepted.
- Browser-facing responses strip tokens after setting httpOnly cookies on the **web** origin.
- Email confirm uses same-origin `/auth/confirm` → server-side bridge (cookies must not be set on `API_ORIGIN`).

### Supabase Auth redirect URLs
- Password-reset / email-change confirmation links generated by Supabase Auth must land on the **web** origin, then bridge to the API. Allow-list the following URLs under **Authentication → URL Configuration → Redirect URLs** for each environment:
  - Local: `http://127.0.0.1:3025/auth/confirm`
  - Staging: `https://<staging-web-origin>/auth/confirm`
  - Production: `https://<web-origin>/auth/confirm`
- The recovery flow is: `/forgot-password` → `POST /api/v1/auth/forgot-password` (calls Supabase `resetPasswordForEmail` with `redirectTo = <web-origin>/auth/confirm?next=/reset-password`) → email link → `/auth/confirm` (exchanges code, sets httpOnly cookies via bridge) → `/reset-password` → `POST /api/v1/auth/reset-password`.
- Invalid/expired confirmation codes are not granted a session; the web confirm route redirects to `/login?error=confirm` so the user can request a new link.
- Email-change confirmation (new-address-only, per project "Confirm email change" setting) follows the same `/auth/confirm` exchange and returns to Preferences.

### Page / API enforcement
- Next session gate: **public allowlist** (`/`, auth pages, `/reset-password`, `/auth/confirm`); all other pages require a session (fail closed).
- API: public auth/health/openapi; domain + admin routes authenticated + capability-checked; cron via `CRON_SECRET`. Client-supplied user IDs / roles / capabilities are never trusted as authorization input.
- CSRF: `SameSite=lax` + same-origin `/api` (no separate CSRF token). CORS locked to `WEB_ORIGIN` with credentials.

### Abuse protection & errors
- Backend rate limits (hooks `as: "global"`): sensitive auth 20/min, other auth 60/min, general 180/min, cron 10/min. **Redis when `REDIS_URL` is set; otherwise in-memory (dev/single-node).**
- `TRUST_PROXY=true` required before trusting `X-Forwarded-For` / `X-Real-IP` for rate-limit keys.
- Body limits: 1 MiB JSON; attachments max 10 MiB with MIME allowlist.
- Progressive delay on repeated failed logins (per email+IP); no permanent lockout.
- Client errors use the nested v1 error envelope; auth messages stay generic. Provider details go to server logs only.

### Observability & headers
- Every request gets a `requestId` (UUID; client-provided non-UUID ids are replaced). Echoed as `X-Request-Id` and included on error bodies. Propagated into auth audit rows.
- `auth_audit_events` table + structured `[auth-audit]` logs (no passwords/tokens/secrets).
- Production: `Strict-Transport-Security`; always `X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy`; `Cache-Control: private, no-store` on `/api/*`.
- Serve auth over HTTPS in production. Rotate Supabase JWT/service keys, `CRON_SECRET`, and `AUTH_BRIDGE_SECRET` via env/secret store (never commit secrets).

### Env
- See `.env.example`: `DATABASE_URL`, `SUPABASE_*`, `SUPABASE_JWT_SECRET`, `RESEND_*`, `CRON_SECRET`, `AUTH_BRIDGE_SECRET`, `REDIS_URL` (optional), `TRUST_PROXY` (optional), `WEB_ORIGIN`, `API_ORIGIN`, `API_PORT`.

## 5. Folder Structure

```
/
  apps/web/                 # Next.js UI :3025
  apps/api/                 # Elysia + Bun :4025
  packages/db/              # Drizzle schema + client
  packages/validation/      # shared Zod schemas
  packages/domain/          # pure reminder evaluation
  supabase/migrations/      # SQL DDL / RLS / triggers
  docs/
  nx.json
  package.json              # Bun workspaces
```

## 6. Deployment
- Hosting: **TBD** (`product.md` §10). Local: Bun + Nx (`bun run dev`).
- Production scheduler / API host: **TBD**.

## 7. Open Architecture Questions
- [ ] Final production host for `apps/api` and cron runner.
- [ ] Final hosting for `apps/web`.
- [ ] Realtime notifications vs polling (MVP: polling).
- [ ] Storage cleanup when attachments/tasks are deleted.
- [ ] Max retry / backoff for failed emails (`DOMAIN.md` §7).
