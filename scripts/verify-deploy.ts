#!/usr/bin/env bun
/**
 * verify-deploy.ts — post-deploy verification gate (W4).
 *
 * Asserts the LIVE deployment is the code + config we think it is:
 *   1. API /health 200 with `commit` == expected git SHA (catches stale
 *      deploys — e.g. Railway running pre-env-change code, 2026-09-27).
 *   2. Web /login HTML contains the form (catches the 2026-09-27 silent
 *      prerender outage class at the deployed layer).
 *   3. CSP variant per route: `/` → sha256 without nonce; `/login` → nonce.
 *   4. Bootstrap 401 envelope shape (proves the auth chain, not just TCP).
 *   5. /health/cron is 200 or 503 — never 500 (DB wiring proof).
 *
 * Usage:
 *   bun run scripts/verify-deploy.ts [--commit <sha>] [--api URL] [--web URL]
 *     [--wait-commit SECS]
 * Defaults: commit = local `git rev-parse HEAD`, API/WEB = prod domains,
 * wait = 600s polling for the expected commit (push-triggered runs race
 * platform builds; 0 = check once).
 * Exits non-zero on the first failure. Safe to run on a schedule.
 */
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const argv = process.argv.slice(2);
function flag(name: string): string | undefined {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : undefined;
}

// Bun auto-loads .env.local (dev values); the prod operator file must WIN.
const prodEnv = join(import.meta.dir, "..", ".env.production");
if (existsSync(prodEnv)) {
  for (const line of readFileSync(prodEnv, "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Za-z_][\w]*)\s*=\s*(.*)\s*$/);
    if (!m) continue;
    let v = m[2].trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
      v = v.slice(1, -1);
    }
    const comment = v.indexOf("  #");
    process.env[m[1]] = (comment > 0 ? v.slice(0, comment) : v).trim();
  }
}

/** First non-empty value wins (bun-injected dev blanks must not shadow prod). */
function pick(...names: (string | undefined)[]): string | undefined {
  for (const n of names) {
    if (!n) continue;
    const v = process.env[n];
    if (v !== undefined && v !== "") return v;
  }
  return undefined;
}

function localHead(): string {
  const r = spawnSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" });
  return (r.stdout ?? "").trim();
}

const EXPECTED_COMMIT = flag("--commit") ?? pick("EXPECT_COMMIT") ?? localHead();
const API = (flag("--api") ?? pick("API_ORIGIN", "PROD_API_URL") ?? "https://deadline-radar-api-production.up.railway.app").replace(/\/$/, "");
const WEB = (flag("--web") ?? pick("WEB_ORIGIN", "PROD_WEB_URL") ?? "https://deadline-radar-web.vercel.app").replace(/\/$/, "");
// Push-triggered runs race the platform builds: poll for the expected commit
// instead of failing on the first mismatch (0 = check once).
const WAIT_COMMIT_SECS = Number(flag("--wait-commit") ?? "600");

let failures = 0;
function check(ok: boolean, label: string, detail = ""): void {
  if (ok) {
    console.log(`[verify-deploy] ok: ${label}`);
  } else {
    failures += 1;
    console.error(`[verify-deploy] FAIL: ${label}${detail ? ` — ${detail}` : ""}`);
  }
}

async function getText(url: string, init: RequestInit = {}): Promise<{ status: number; text: string; headers: Headers }> {
  const res = await fetch(url, { ...init, redirect: "manual" });
  return { status: res.status, text: await res.text(), headers: res.headers };
}

// 1. API health + commit match (polled: pushes race platform builds).
{
  const { status, text } = await getText(`${API}/health`);
  let body: Record<string, unknown> = {};
  try {
    body = JSON.parse(text) as Record<string, unknown>;
  } catch { /* handled below */ }
  check(status === 200, `API /health 200 (got ${status})`);
  check(body.ok === true, "API /health ok:true");
  const short = EXPECTED_COMMIT.slice(0, 7);
  const deadline = Date.now() + Math.max(0, WAIT_COMMIT_SECS) * 1000;
  let commit: string | null =
    typeof body.commit === "string" ? body.commit : null;
  let matched =
    commit !== null &&
    (commit === EXPECTED_COMMIT || (short.length === 7 && commit.startsWith(short)));
  while (!matched && Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 20000));
    try {
      const retry = await getText(`${API}/health`);
      const retryBody = JSON.parse(retry.text) as Record<string, unknown>;
      commit = typeof retryBody.commit === "string" ? retryBody.commit : null;
      matched =
        commit !== null &&
        (commit === EXPECTED_COMMIT || (short.length === 7 && commit.startsWith(short)));
    } catch { /* keep polling */ }
  }
  check(
    matched,
    `API commit == ${short} (got ${commit ?? "none"})`,
  );
}

// 2. Login page contains the form (2026-09-27 regression).
{
  const { status, text } = await getText(`${WEB}/login`);
  check(status === 200, `WEB /login 200 (got ${status})`);
  check(text.includes("<form"), "WEB /login HTML contains <form");
  check(text.includes('id="login-email"') || text.includes("login-email"), "WEB /login HTML contains email field");
}

// 3. CSP variant per route.
{
  const login = await getText(`${WEB}/login`);
  const csp = login.headers.get("content-security-policy") ?? "";
  check(csp.includes("nonce-"), "WEB /login CSP uses nonce (dynamic page)");
  const home = await getText(`${WEB}/`);
  const homeCsp = home.headers.get("content-security-policy") ?? "";
  check(homeCsp.includes("sha256-"), "WEB / CSP uses hashes (static page)");
  check(!homeCsp.includes("nonce-"), "WEB / CSP has no nonce");
}

// 4. Bootstrap 401 envelope shape.
{
  const { status, text } = await getText(`${API}/api/v1/bootstrap`);
  let body: Record<string, unknown> = {};
  try {
    body = JSON.parse(text) as Record<string, unknown>;
  } catch { /* handled below */ }
  check(status === 401, `API bootstrap unauth 401 (got ${status})`);
  const err = body.error as Record<string, unknown> | undefined;
  check(typeof err?.code === "string", "bootstrap 401 carries error.code envelope");
}

// 5. DB wiring: cron health is 200 (run recorded) or 503 (no run yet) — never 500.
{
  const { status } = await getText(`${API}/health/cron`);
  check(status === 200 || status === 503, `API /health/cron 200/503 (got ${status})`);
}

if (failures > 0) {
  console.error(`[verify-deploy] ${failures} FAILURE(S)`);
  process.exit(1);
}
console.log("[verify-deploy] ALL GREEN");
