#!/usr/bin/env bun
/**
 * auth-smoke.ts — end-to-end auth + wiring smoke without a browser or email.
 *
 * Exercises the exact path users hit on register/login outages:
 *   1. Admin API creates an auto-confirmed user (no email sent, no rate
 *      limits burned — unlike signUp).
 *   2. `POST /api/v1/auth/login` must return 200 + JWT.
 *   3. The JWT `iss` MUST equal the expected Supabase project. This is the
 *      stale-wiring killer: after a Supabase move, an API still pointed at
 *      the old project issues tokens with the old `iss` (or fails outright).
 *   4. `GET /api/v1/bootstrap` with the token must return the full envelope
 *      (proves RLS + capabilities + summary RPC on the live DB).
 *   5. Admin API deletes the user (try/finally — zero residue).
 *
 * What it does NOT cover (documented limitation): the signUp email-confirm
 * flow (would burn Supabase SMTP quota) — that behavior stays a dashboard
 * setting (PROD_ENV_CHECKLIST DASH-SB) plus the Playwright register spec.
 *
 * Env (or .env.production/.env.local values):
 *   SUPABASE_URL, SUPABASE_ANON_KEY (or NEXT_PUBLIC_*), SUPABASE_SERVICE_ROLE_KEY,
 *   API_ORIGIN (or PROD_API_URL)
 *
 * Usage: `bun run scripts/auth-smoke.ts` — exits non-zero on any failure.
 */
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

function loadDotenv(path: string, overwrite: boolean): void {
  if (!existsSync(path)) return;
  for (const line of readFileSync(path, "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Za-z_][\w]*)\s*=\s*(.*)\s*$/);
    if (!m || (!overwrite && process.env[m[1]] !== undefined)) continue;
    let v = m[2].trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
      v = v.slice(1, -1);
    }
    const comment = v.indexOf("  #");
    process.env[m[1]] = (comment > 0 ? v.slice(0, comment) : v).trim();
  }
}

const rootDir = join(import.meta.dir, "..");
// Bun auto-loads .env.local; the prod operator file must WIN for prod smoke.
loadDotenv(join(rootDir, ".env.production"), true);

function required(name: string, fallback?: string): string {
  const v = process.env[name] ?? (fallback ? process.env[fallback] : undefined);
  if (!v) {
    console.error(`[auth-smoke] missing env: ${name}`);
    process.exit(1);
  }
  return v;
}

const SUPABASE_URL = required("SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_URL").replace(/\/$/, "");
const ANON_KEY = required("SUPABASE_ANON_KEY", "NEXT_PUBLIC_SUPABASE_ANON_KEY");
const SERVICE_KEY = required("SUPABASE_SERVICE_ROLE_KEY");
const API = (process.env.API_ORIGIN ?? process.env.PROD_API_URL ?? "http://127.0.0.1:4025").replace(/\/$/, "");
// Auth bridge: the API only embeds tokens in JSON bodies for callers holding
// this secret (the web route handlers). The smoke acts as a bridge caller.
const BRIDGE_SECRET = required("AUTH_BRIDGE_SECRET");
const BRIDGE_HEADERS = { "x-dr-auth-bridge": BRIDGE_SECRET };

const EXPECTED_REF = new URL(SUPABASE_URL).hostname.split(".")[0];
const EXPECTED_ISS = `${SUPABASE_URL}/auth/v1`;

function decodeJwtPayload(token: string): Record<string, unknown> {
  const parts = token.split(".");
  if (parts.length !== 3) throw new Error("not a JWT");
  return JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8")) as Record<string, unknown>;
}

async function api<T>(path: string, init: RequestInit = {}): Promise<{ status: number; body: T }> {
  const res = await fetch(`${API}${path}`, {
    ...init,
    headers: { "content-type": "application/json", ...(init.headers ?? {}) },
  });
  const text = await res.text();
  let body: unknown = null;
  try {
    body = text ? (JSON.parse(text) as unknown) : null;
  } catch {
    body = text;
  }
  return { status: res.status, body: body as T };
}

function assert(cond: boolean, message: string): void {
  if (!cond) {
    console.error(`[auth-smoke] FAIL: ${message}`);
    process.exit(1);
  }
  console.log(`[auth-smoke] ok: ${message}`);
}

const tag = Date.now().toString(36);
const email = `smoke-${tag}@rapm.space`;
const password = `Smoke-${tag}-1!`;
let userId: string | null = null;

async function adminDelete(): Promise<void> {
  if (!userId) return;
  await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${userId}`, {
    method: "DELETE",
    headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` },
  });
}

try {
  // 1. Create auto-confirmed user (no email sent).
  const created = await fetch(`${SUPABASE_URL}/auth/v1/admin/users`, {
    method: "POST",
    headers: {
      apikey: SERVICE_KEY,
      Authorization: `Bearer ${SERVICE_KEY}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({ email, password, email_confirm: true }),
  });
  const createdBody = (await created.json()) as { id?: string };
  assert(created.status === 200 && !!createdBody.id, `admin createUser (${created.status})`);
  userId = createdBody.id!;

  // 2. Login via the real API (as a bridge caller, so tokens are in-body).
  const login = await api<{
    accessToken?: string;
    user?: { id?: string };
  }>("/api/v1/auth/login", {
    method: "POST",
    headers: BRIDGE_HEADERS,
    body: JSON.stringify({ email, password }),
  });
  assert(login.status === 200, `login 200 (got ${login.status})`);
  const token = login.body.accessToken;
  assert(!!token && !!login.body.user?.id, "login returns session + user");
  assert(login.body.user!.id === userId, "login user matches created user");

  // 3. JWT issuer must be the expected project (stale-wiring killer).
  const claims = decodeJwtPayload(token!);
  assert(
    claims.iss === EXPECTED_ISS,
    `JWT iss == ${EXPECTED_REF} (got ${String(claims.iss)})`,
  );

  // 4. Bootstrap proves RLS + capabilities + summary RPC on the live DB.
  const boot = await api<{
    user?: { id?: string };
    courses?: unknown[];
    summary?: Record<string, number>;
    progress?: Record<string, unknown>;
  }>("/api/v1/bootstrap", {
    headers: { authorization: `Bearer ${token}` },
  });
  assert(boot.status === 200, `bootstrap 200 (got ${boot.status})`);
  assert(boot.body.user?.id === userId, "bootstrap user matches");
  assert(Array.isArray(boot.body.courses), "bootstrap courses array");
  assert(
    typeof boot.body.summary?.allTasks === "number",
    "bootstrap summary ints",
  );
  assert(typeof boot.body.progress?.total === "number", "bootstrap progress");
} finally {
  await adminDelete();
}

console.log("[auth-smoke] ALL GREEN");
