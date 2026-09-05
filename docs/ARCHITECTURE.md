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
                       └────────────┬───────────┘       └──────────┘
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
                       │ Cron → GET /api/cron/  │
                       │ evaluate-reminders     │
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
Owns **all auth, domain API, and business logic**:
- Auth: register, login, logout, password reset, session, timezone
- CRUD: courses, tasks, thresholds, attachments, notifications
- Cron: `GET /api/cron/evaluate-reminders` (Bearer `CRON_SECRET`)
- Contract: OpenAPI at `/openapi` (typed client under `apps/web/lib/api`)

Layering: **routes → services → Drizzle repos**. App-layer authorization by authenticated `user_id`. Existing Postgres RLS remains defense-in-depth.

### 2.3 Database — Supabase Postgres + Drizzle
- DDL / triggers / RLS: `supabase/migrations/` (source of schema truth for this branch)
- Query layer: `@deadline-radar/db` (Drizzle schema mirroring `DATA-MODEL.md`)
- Privileged `DATABASE_URL` from the API (service DB role)

### 2.4 Storage — Supabase Storage
- Private bucket `attachments`; API uses service role for upload/signed URLs
- Path: `attachments/{user_id}/{task_id}/{filename}`

### 2.5 Email — Resend
- Reminder emails from the API cron/evaluator path

### 2.6 Scheduler
- Endpoint lives on Elysia (`/api/cron/evaluate-reminders`)
- Production runner (pg_cron, external cron, host scheduler) remains **TBD** per `product.md`
- Local: `curl -H "Authorization: Bearer $CRON_SECRET" http://127.0.0.1:4025/api/cron/evaluate-reminders`

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
- App auth context (`AuthUser`): `userId` (`id`), optional `email`, optional `sessionId` from JWT `session_id`. Authorization stays in domain routes via `requireUser().id` — not inside login/session logic.

### Session / cookies
- Elysia sets `dr_access_token` / `dr_refresh_token` httpOnly cookies (`Secure` in production, `SameSite=lax`, `Path=/`) after login/register/confirm/refresh.
- Access lifetime ≈ Supabase `expires_in`; refresh absolute max-age 30 days. Idle timeout N/A (stateless JWT); refresh renews access.
- `POST /api/auth/refresh` rotates tokens via Supabase `refreshSession`. Next `proxy.ts` silently refreshes when access JWT is invalid but refresh cookie is present.
- Logout: `POST /api/auth/logout` (current session, `signOut` local) and `POST /api/auth/logout-all` (global). Password reset completion clears cookies and global sign-out.
- JWT verified via Supabase **JWKS** (ES256/RS256/EdDSA; legacy HS256 JWT secret optional fallback) on protected API routes **and** in the Next proxy.
- Invalid/expired tokens are cleared by `/api/auth/session`, refresh failure, and API `401`.

### Token transport (no browser JS secrets)
- Access/refresh tokens appear in JSON **only** when the caller sends `x-dr-auth-bridge: 1` (Next server bridges for login/register/confirm/refresh/proxy).
- Browser-facing responses strip tokens after setting httpOnly cookies on the **web** origin.
- Email confirm uses same-origin `/auth/confirm` → server-side bridge (cookies must not be set on `API_ORIGIN`).

### Page / API enforcement
- Next session gate: **public allowlist** (`/`, auth pages, `/reset-password`, `/auth/confirm`); all other pages require a session (fail closed).
- API: auth routes public; domain routes `requireUser()`; cron via `CRON_SECRET`. Client-supplied user IDs are never trusted as identity.
- CSRF: `SameSite=lax` + same-origin `/api` (no separate CSRF token). CORS locked to `WEB_ORIGIN` with credentials.

### Abuse protection & errors
- Backend rate limits (in-memory; hooks registered `as: "global"`): sensitive auth 20/min, other auth 60/min, general 180/min, cron 10/min. **Redis required for multi-node.**
- Progressive delay on repeated failed logins (per email+IP); no permanent lockout.
- Client errors are generic (`Invalid credentials.`, forgot-password always succeeds generically). Provider details go to server logs only.

### Observability & headers
- `auth_audit_events` table + structured `[auth-audit]` logs (no passwords/tokens/secrets).
- Production: `Strict-Transport-Security`; always `X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy`; `Cache-Control: private, no-store` on `/api/*`.
- Serve auth over HTTPS in production. Rotate Supabase JWT/service keys and `CRON_SECRET` via env/secret store (never commit secrets).

### Env
- See `.env.example`: `DATABASE_URL`, `SUPABASE_*`, `SUPABASE_JWT_SECRET`, `RESEND_*`, `CRON_SECRET`, `WEB_ORIGIN`, `API_ORIGIN`, `API_PORT`.

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
