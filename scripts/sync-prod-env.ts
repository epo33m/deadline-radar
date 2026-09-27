#!/usr/bin/env bun
/**
 * Sync production env from `.env.production` into the deploy platforms' secret
 * stores — Railway (API), Vercel (Web) — plus the two GitHub secrets the
 * scheduler workflow needs.
 *
 * Why a script: the values exist exactly once (`.env.production`, gitignored)
 * so the API and Web copies of `AUTH_BRIDGE_SECRET` can never drift apart, and
 * so nobody has to paste secrets through a dashboard by hand.
 *
 * Safety rules:
 * - Dry run unless `--apply` is passed.
 * - Values are piped to child processes on stdin, never passed through a shell
 *   and never written to disk.
 * - Placeholder values (`https://...`, `${{PORT}}`) and blanks are hard errors
 *   unless the key is explicitly deferred (the two origin vars that only exist
 *   after the counterpart app is deployed).
 *
 * Usage:
 *   bun run scripts/sync-prod-env.ts                        # plan only
 *   bun run scripts/sync-prod-env.ts --apply                # all three targets
 *   bun run scripts/sync-prod-env.ts --apply --only api
 *   bun run scripts/sync-prod-env.ts --apply --vercel-project deadline-radar
 *   bun run scripts/sync-prod-env.ts --apply --railway-service api
 *
 * Prerequisites (one-time, interactive): `railway login`, `vercel login`,
 * `gh auth login`. See docs/DEPLOY-PROD.md for the dashboard steps this
 * replaces.
 */
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";

const rootDir = resolve(import.meta.dir, "..");
const envFiles = [
  join(rootDir, ".env.production"),
  join(rootDir, ".env.local"),
] as const;

/** Railway (ENV-API). NODE_ENV/API_PORT are baked into the image (Dockerfile). */
const API_KEYS = [
  "REMINDER_CUTOFF_ISO",
  "DATABASE_URL",
  "SUPABASE_URL",
  "SUPABASE_ANON_KEY",
  "SUPABASE_SERVICE_ROLE_KEY",
  "CRON_SECRET",
  "AUTH_BRIDGE_SECRET",
  "REDIS_URL",
  "UPSTASH_REDIS_REST_URL",
  "UPSTASH_REDIS_REST_TOKEN",
  "RESEND_API_KEY",
  "RESEND_FROM_EMAIL",
  "WEB_ORIGIN",
  "AUTH_AUDIT_RETENTION_DAYS",
] as const;

/** Vercel (ENV-WEB). Scoped to Production by the `--sensitive` split below. */
const WEB_KEYS = [
  "API_ORIGIN",
  "NEXT_PUBLIC_SUPABASE_URL",
  "NEXT_PUBLIC_SUPABASE_ANON_KEY",
  "AUTH_BRIDGE_SECRET",
  "SUPABASE_JWT_SECRET",
  "NEXT_PUBLIC_SENTRY_DSN",
] as const;

/** Public by design — inlined into the client bundle, so not `--sensitive`. */
const WEB_PUBLIC = new Set<string>([
  "NEXT_PUBLIC_SUPABASE_URL",
  "NEXT_PUBLIC_SUPABASE_ANON_KEY",
  "NEXT_PUBLIC_SENTRY_DSN",
]);

/** Documented as optional: legacy HS256 fallback and Sentry (off while unset). */
const OPTIONAL = new Set<string>(["SUPABASE_JWT_SECRET", "NEXT_PUBLIC_SENTRY_DSN"]);

/**
 * Origin vars cannot exist before the counterpart app has a domain: the API
 * needs the Vercel domain, Vercel needs the Railway domain. Reported as
 * deferred, never pushed as a placeholder.
 */
const DEFERRED = new Set<string>(["WEB_ORIGIN", "API_ORIGIN"]);

type Vars = Record<string, string>;

/**
 * Mirrors how the runtime itself tokenizes a value (Bun 1.4 dotenv), verified
 * against `bun --env-file`:
 *   A=secret   # note   -> "secret"   (comment stripped, trimmed)
 *   B=has # hash inside -> "has"      (stripped without preceding space)
 *   C="quoted # kept" v -> "quoted # kept" (# inside quotes is protected)
 *   D=pass#nospace      -> "pass"
 * Getting this wrong would push trailing comments into the secret stores, so
 * `selftest()` asserts the four cases before anything is read or sent.
 */
function parseValue(rawInput: string): string {
  const raw = rawInput.trim();
  let end = raw.length;
  let quote: string | null = null;
  for (let i = 0; i < raw.length; i++) {
    const ch = raw[i];
    if (quote) {
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      continue;
    }
    if (ch === "#") {
      end = i;
      break;
    }
  }
  const head = raw.slice(0, end).trim();
  const first = head[0];
  if ((first === '"' || first === "'") && head.includes(first, 1)) {
    return head.slice(1, head.indexOf(first, 1));
  }
  return head;
}

function selftest(): void {
  const cases: Array<[string, string]> = [
    ["A=secret   # note", "secret"],
    ["B=has # hash inside", "has"],
    ['C="quoted # kept" v', "quoted # kept"],
    ["D=pass#nospace", "pass"],
    ["E=plain", "plain"],
  ];
  for (const [input, expected] of cases) {
    const key = input.slice(0, input.indexOf("="));
    const actual = parseValue(input.slice(input.indexOf("=") + 1));
    if (actual !== expected) {
      console.error(
        `dotenv parser diverges from the runtime: ${key} parsed ${JSON.stringify(actual)}, expected ${JSON.stringify(expected)}`,
      );
      process.exit(1);
    }
  }
}

const argv = process.argv.slice(2);
const apply = argv.includes("--apply");
const onlyIndex = argv.indexOf("--only");
const only = onlyIndex >= 0 ? argv[onlyIndex + 1] : undefined;
const vercelProject = valueOf("--vercel-project");
const railwayService = valueOf("--railway-service");
const environment = valueOf("--environment") ?? "production";

function valueOf(flag: string): string | undefined {
  const i = argv.indexOf(flag);
  return i >= 0 ? argv[i + 1] : undefined;
}

const failures: string[] = [];
const deferred: string[] = [];
/**
 * Key → value actually chosen by the planner (`.env.production` first,
 * `.env.local` only for public web vars). Every consumer must read from here,
 * never by merging the two files: a plain `{...prod, ...local}` spread lets
 * `.env.local` silently win, which once pushed the local `test-*` CRON_SECRET
 * and a `http://127.0.0.1` API URL to the GitHub scheduler secret.
 */
const resolvedVars: Vars = {};

function parseEnv(path: string): Vars {
  const out: Vars = {};
  let text: string;
  try {
    text = readFileSync(path, "utf8");
  } catch {
    return out;
  }
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (line === "" || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq < 1) continue;
    const key = line.slice(0, eq).trim();
    out[key] = parseValue(line.slice(eq + 1));
  }
  return out;
}

/** `.env.production` wins; `.env.local` only backfills the public web vars. */
function resolveValue(key: string, primary: Vars, fallback: Vars) {
  const fromPrimary = primary[key];
  if (fromPrimary !== undefined && fromPrimary !== "") {
    return { value: fromPrimary, source: ".env.production" };
  }
  if (WEB_PUBLIC.has(key)) {
    const fromFallback = fallback[key];
    if (fromFallback !== undefined && fromFallback !== "") {
      return { value: fromFallback, source: ".env.local" };
    }
  }
  return undefined;
}

function isPlaceholder(value: string): boolean {
  return value.includes("...") || value.includes("{{") || value.includes("${");
}

function mask(value: string): string {
  return `${value.slice(0, 4)}…(${value.length} chars)`;
}

function hasBin(name: string): boolean {
  return Bun.which(name) !== null;
}

function run(
  cmd: string,
  args: string[],
  input?: string,
): { ok: boolean; out: string } {
  const res = spawnSync(cmd, args, {
    input: input ?? "",
    encoding: "utf8",
    // No shell: values never reach a command line interpreter.
    shell: false,
  });
  const out = `${res.stdout ?? ""}${res.stderr ?? ""}`.trim();
  if (res.status !== 0) {
    console.error(`  ✗ ${cmd} ${args.filter((a) => !a.includes("=")).join(" ")}`);
    if (out) console.error(`    ${out.split("\n").slice(0, 4).join("\n    ")}`);
  }
  return { ok: res.status === 0, out };
}

type Planned = { key: string; value: string; source: string };

function plan(
  keys: readonly string[],
  primary: Vars,
  fallback: Vars,
  target: string,
): Planned[] {
  const planned: Planned[] = [];
  console.log(`\n${target}`);
  for (const key of keys) {
    const resolved = resolveValue(key, primary, fallback);
    if (!resolved) {
      if (OPTIONAL.has(key)) {
        console.log(`  ○ ${key.padEnd(28)} optional — unset, skipped (SDK stays disabled)`);
      } else if (DEFERRED.has(key)) {
        deferred.push(`${target} ${key}`);
        console.log(`  ○ ${key.padEnd(28)} deferred — counterpart domain not deployed yet`);
      } else {
        failures.push(`${target}: ${key} missing from .env.production`);
        console.log(`  ✗ ${key.padEnd(28)} MISSING`);
      }
      continue;
    }
    if (isPlaceholder(resolved.value)) {
      if (DEFERRED.has(key)) {
        deferred.push(`${target} ${key}`);
        console.log(`  ○ ${key.padEnd(28)} deferred — still a placeholder (${resolved.value})`);
      } else {
        failures.push(`${target}: ${key} is still a placeholder (${resolved.value})`);
        console.log(`  ✗ ${key.padEnd(28)} PLACEHOLDER ${resolved.value}`);
      }
      continue;
    }
    planned.push({ key, value: resolved.value, source: resolved.source });
    resolvedVars[key] = resolved.value;
    console.log(
      `  ✓ ${key.padEnd(28)} ${mask(resolved.value)} (${resolved.source})`,
    );
  }
  return planned;
}

// --- Railway -----------------------------------------------------------------

let railwayStdinFlag: string[] | null = null;

function resolveRailwayStrategy(): string[] {
  if (railwayStdinFlag) return railwayStdinFlag;
  const legacy = run("railway", ["variables", "--help"]);
  if (legacy.ok && legacy.out.includes("--set-from-stdin")) {
    railwayStdinFlag = ["variables", "--set-from-stdin"];
    return railwayStdinFlag;
  }
  const sub = run("railway", ["variable", "set", "--help"]);
  if (sub.ok && sub.out.includes("--stdin")) {
    railwayStdinFlag = ["variable", "set"];
    return railwayStdinFlag;
  }
  // Last resort: the value lands in argv (no shell, but visible in `ps`).
  console.warn(
    "  ! railway CLI has no stdin flag — falling back to --set KEY=VALUE (value visible in ps)",
  );
  railwayStdinFlag = ["variables", "--set"];
  return railwayStdinFlag;
}

function applyRailway(planned: Planned[]): void {
  const base = [...resolveRailwayStrategy()];
  if (base[base.length - 1] === "--set") base.push("");
  for (const { key, value } of planned) {
    const args = [...base];
    if (base.includes("--set")) {
      args[args.length - 1] = `${key}=${value}`;
    } else {
      args.push(key);
    }
    args.push("--environment", environment, "--skip-deploys");
    if (railwayService) args.push("--service", railwayService);
    const { ok } = run("railway", args, value);
    if (!ok) failures.push(`railway: ${key} not set`);
  }
}

// --- Vercel ------------------------------------------------------------------

function applyVercel(planned: Planned[]): void {
  for (const { key, value } of planned) {
    const args = ["env", "add", key, environment, "--force", "--yes"];
    // `--sensitive` only: leaving the public default unset makes the CLI abort
    // on its "looks like a credential" prompt even with --yes.
    args.push(WEB_PUBLIC.has(key) ? "--no-sensitive" : "--sensitive");
    if (vercelProject) args.push("--project", vercelProject);
    const { ok } = run("vercel", args, value);
    if (!ok) failures.push(`vercel: ${key} not set`);
  }
}

// --- GitHub ------------------------------------------------------------------

function ghRepo(): string | undefined {
  const res = spawnSync("git", ["remote", "get-url", "origin"], {
    encoding: "utf8",
  });
  const url = (res.stdout ?? "").trim();
  const m = url.match(/github\.com[:/]+([^/]+)\/([^/.]+)/);
  return m ? `${m[1]}/${m[2]}` : undefined;
}

function applyGithub(targets: Array<[string, string | undefined]>): void {
  const repo = ghRepo();
  if (!repo) {
    failures.push("github: cannot determine repo from git origin");
    return;
  }
  // `gh secret set NAME` reads the value from stdin when --body is omitted, so
  // nothing is written to disk and nothing lands in argv (gh has no
  // --body-file in 2.101; it only has -f/--env-file for dotenv batches).
  for (const [name, value] of targets) {
    if (!value || isPlaceholder(value)) {
      failures.push(`github: ${name} has no usable value yet`);
      console.log(`  ✗ ${name.padEnd(28)} no value (API_ORIGIN not deployed yet?)`);
      continue;
    }
    const { ok } = run("gh", ["secret", "set", name, "--repo", repo], value);
    if (!ok) failures.push(`github: ${name} not set`);
    else console.log(`  ✓ ${name.padEnd(28)} ${mask(value)}`);
  }
}

// --- main --------------------------------------------------------------------

selftest();

const primary = parseEnv(envFiles[0]);
const fallback = parseEnv(envFiles[1]);

if (Object.keys(primary).length === 0) {
  console.error(
    `No vars parsed from ${envFiles[0]} — fill it first (see docs/DEPLOY-PROD.md).`,
  );
  process.exit(1);
}

const targets: Record<string, boolean> = {
  api: !only || only === "api",
  web: !only || only === "web",
  github: !only || only === "github",
};
if (only && !targets[only]) {
  console.error(`--only must be one of: api, web, github`);
  process.exit(1);
}

console.log(`Source: ${envFiles[0]}`);
console.log(`Mode:   ${apply ? "APPLY (writes to remote secret stores)" : "DRY RUN (pass --apply to write)"}`);

const apiPlan = targets.api ? plan(API_KEYS, primary, fallback, "Railway — ENV-API") : [];
const webPlan = targets.web ? plan(WEB_KEYS, primary, fallback, "Vercel — ENV-WEB") : [];

if (targets.github) {
  // GitHub secrets the scheduler workflow reads. PROD_API_URL is derived from
  // API_ORIGIN, so it stays unavailable until the API has a public domain —
  // reported, never fatal here, so `--only api` still works before that.
  const cronSecret = resolveValue("CRON_SECRET", primary, fallback);
  console.log(`\nGitHub — repository secrets`);
  if (cronSecret && !isPlaceholder(cronSecret.value)) {
    resolvedVars.CRON_SECRET = cronSecret.value;
    console.log(
      `  ✓ ${"CRON_SECRET".padEnd(28)} ${mask(cronSecret.value)} (${cronSecret.source})`,
    );
  } else {
    failures.push("github: CRON_SECRET missing or placeholder in .env.production");
    console.log(`  ✗ ${"CRON_SECRET".padEnd(28)} MISSING`);
  }
  const apiOrigin = webPlan.find((p) => p.key === "API_ORIGIN")?.value;
  if (apiOrigin) {
    resolvedVars.PROD_API_URL = apiOrigin;
    console.log(`  ✓ ${"PROD_API_URL".padEnd(28)} ${mask(apiOrigin)} (from API_ORIGIN)`);
  } else {
    console.log(
      `  ○ ${"PROD_API_URL".padEnd(28)} deferred — set API_ORIGIN first (Railway domain)`,
    );
  }
}

if (deferred.length > 0) {
  console.log(`\nDeferred (expected before first deploy): ${deferred.join(", ")}`);
}

if (failures.length > 0) {
  console.error(`\nRefusing to continue:`);
  for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}

if (!apply) {
  console.log(`\nDry run only. Re-run with --apply to write these values.`);
  process.exit(0);
}

console.log(`\nApplying…`);

if (targets.api) {
  if (!hasBin("railway")) {
    failures.push("railway CLI not found — npm i -g @railway/cli, then railway login");
  } else if (!run("railway", ["whoami"]).ok) {
    failures.push("railway not authenticated — run `railway login`");
  } else {
    applyRailway(apiPlan);
  }
}

if (targets.web) {
  if (!hasBin("vercel")) {
    failures.push("vercel CLI not found — npm i -g vercel, then vercel login");
  } else if (!run("vercel", ["whoami"]).ok) {
    failures.push("vercel not authenticated — run `vercel login`");
  } else {
    applyVercel(webPlan);
  }
}

if (targets.github) {
  if (!hasBin("gh")) {
    failures.push("gh CLI not found — brew install gh, then gh auth login");
  } else {
    // Values come from the planner's resolved map, never from re-merging the
    // env files (see resolvedVars).
    applyGithub([
      ["CRON_SECRET", resolvedVars.CRON_SECRET],
      ["PROD_API_URL", resolvedVars.PROD_API_URL],
    ]);
  }
}

if (failures.length > 0) {
  console.error(`\nCompleted with errors:`);
  for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}

console.log(`\nDone. Next: docs/DEPLOY-PROD.md §1 (deploy order) and §6 (verification).`);
