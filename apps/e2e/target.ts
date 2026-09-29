/**
 * E2E target resolution.
 *
 * The suite never picks its own target. `E2E_TARGET` names one entry in
 * `TARGETS`, and that entry alone decides the env file, the origins, and the
 * ports. Production is a deny list, never a target: nothing here resolves to a
 * production host, and a target whose env file points at one is refused before
 * any process starts.
 *
 * Why this exists: the root `.env.local` points at production (README,
 * "Staging database"), and this suite writes rows, runs the reminder scheduler
 * in-process, and deletes real auth users. Loading `.env.local` implicitly made
 * `bun run test:e2e` reach production without anyone choosing to.
 *
 * The root `.env.local` is deliberately not read here, directly or
 * transitively. #63 generalises this resolver to the other local scripts.
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));

export const repoRoot = path.resolve(here, "../..");

/**
 * The only environments the E2E suite may target. dev/staging are the same
 * local stack (docs/PROD_ENV_CHECKLIST.md: "Tidak ada staging"); production is
 * deployed only. Adding a production entry is a reviewable code change, not
 * something a developer can reach by setting a variable.
 */
export const TARGETS = {
  staging: {
    envFile: ".env.staging",
    webOrigin: "http://127.0.0.1:3025",
    apiOrigin: "http://127.0.0.1:4025",
    webPort: 3025,
    apiPort: 4025,
  },
} as const;

export type E2ETargetName = keyof typeof TARGETS;

/**
 * Production identifiers, sourced from the root `.env.production`
 * (DATABASE_URL / SUPABASE_URL at lines 23-24, WEB_ORIGIN / API_ORIGIN at
 * lines 40-41). Matched as substrings: a deny list that over-matches is safe,
 * one that under-matches reaches production.
 *
 * Exported so `app-env.ts` matches the Next app directory against the *same*
 * list. Two copies of a security deny list drift.
 */
export const PRODUCTION_MARKERS = [
  "bhtfkuzsdxrdmvvcczse", // production Supabase project ref
  "bhtfkuzsdxrdmvvcczse.supabase.co",
  "deadline-radar-web.vercel.app",
  "deadline-radar-api-production.up.railway.app",
] as const;

/** Env keys whose value decides which database/auth the suite writes to. */
const PRODUCTION_CHECKED_KEYS = [
  "DATABASE_URL",
  "DIRECT_URL",
  "SUPABASE_URL",
  "NEXT_PUBLIC_SUPABASE_URL",
  "WEB_ORIGIN",
  "API_ORIGIN",
] as const;

/** The origins the target itself declares, checked independently of the file. */
const TARGET_ORIGIN_KEYS = ["webOrigin", "apiOrigin"] as const;

/**
 * Override knobs the old config honoured (`E2E_WEB_ORIGIN`, `E2E_API_ORIGIN`,
 * `E2E_WEB_PORT`). They are gone: a stale value in the developer's shell must
 * not aim the browser or the fixtures somewhere other than the chosen target.
 *
 * `E2E_TARGET` is deliberately NOT in this list. Playwright re-imports this
 * config inside every worker process, so the selector has to survive in the
 * environment or the workers cannot resolve their own target.
 */
const REMOVED_OVERRIDE_KEYS = ["E2E_WEB_ORIGIN", "E2E_API_ORIGIN", "E2E_WEB_PORT"] as const;

/**
 * Host-level variables the suite needs regardless of target. Playwright
 * launches `webServer` children with `{ ...defaults, ...process.env, ...env }`
 * (playwright/lib/runner/index.js), so the runner's own environment is the
 * boundary: anything left in it reaches the API and web children.
 */
const PASSTHROUGH_KEYS = [
  "PATH",
  "HOME",
  "SHELL",
  "TMPDIR",
  "TMP",
  "TEMP",
  "LANG",
  "LC_ALL",
  "TZ",
  "USER",
  "CI",
  "TERM",
  "FORCE_COLOR",
  "NODE_OPTIONS",
  "XDG_CACHE_HOME",
  "npm_config_cache",
  "BUN_INSTALL",
] as const;

export type E2ETarget = {
  name: E2ETargetName;
  envFile: string;
  envFilePath: string;
  webOrigin: string;
  apiOrigin: string;
  webPort: number;
  apiPort: number;
  /** Every variable declared by the target's env file. */
  env: Record<string, string>;
};

/** Thrown for every refusal. Carries the message the operator should read. */
export class E2ETargetError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "E2ETargetError";
  }
}

function validTargets(): string {
  return (Object.keys(TARGETS) as E2ETargetName[])
    .map(
      (name) =>
        `  E2E_TARGET=${name}   →  ${TARGETS[name].webOrigin}  (env: ${TARGETS[name].envFile})`,
    )
    .join("\n");
}

/** dotenv semantics: strip an inline ` #` comment unless the value is quoted. */
function unquote(value: string): string {
  const quote = value[0];
  if (quote === '"' || quote === "'" || quote === "`") {
    const end = value.indexOf(quote, 1);
    if (end !== -1) return value.slice(1, end);
  }
  const comment = value.search(/\s#/);
  return (comment === -1 ? value : value.slice(0, comment)).trim();
}

export function parseEnvFile(filePath: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const rawLine of readFileSync(filePath, "utf8").split("\n")) {
    const line = rawLine.trim();
    if (line === "" || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim().replace(/^export\s+/, "");
    if (key === "") continue;
    out[key] = unquote(line.slice(eq + 1).trim());
  }
  return out;
}

/** `[label, value, marker]` for every production reference found in `env`. */
function findProduction(
  env: Record<string, string | undefined>,
  keys: readonly string[],
  label: (key: string) => string,
): [string, string, string][] {
  const found: [string, string, string][] = [];
  for (const key of keys) {
    const value = env[key];
    if (!value) continue;
    const marker = PRODUCTION_MARKERS.find((candidate) => value.includes(candidate));
    if (marker) found.push([label(key), value, marker]);
  }
  return found;
}

/**
 * Resolve the target the suite will run against, or throw.
 *
 * Refuses, in order: no `E2E_TARGET`, an unknown `E2E_TARGET`, a missing env
 * file, and a target whose env file points at production.
 */
export function resolveTarget(
  options: {
    env?: Record<string, string | undefined>;
    root?: string;
  } = {},
): E2ETarget {
  const source = options.env ?? process.env;
  const root = options.root ?? repoRoot;

  const name = source.E2E_TARGET?.trim();
  if (!name) {
    throw new E2ETargetError(
      [
        "E2E_TARGET is not set.",
        "",
        "The E2E suite never picks its own target. Name the one you want:",
        "",
        validTargets(),
        "",
        "Production is not a valid target and cannot be added by setting a variable.",
      ].join("\n"),
    );
  }

  if (!Object.hasOwn(TARGETS, name)) {
    throw new E2ETargetError(
      [`E2E_TARGET=${name} is not a valid E2E target.`, "", "Valid targets:", "", validTargets()].join(
        "\n",
      ),
    );
  }

  const target = TARGETS[name as E2ETargetName];
  const envFilePath = path.resolve(root, target.envFile);
  if (!existsSync(envFilePath)) {
    throw new E2ETargetError(
      [
        `E2E_TARGET=${name} needs ${target.envFile}, which does not exist.`,
        `  looked in: ${envFilePath}`,
        "",
        "Provision it with:  bash scripts/setup-staging-project.sh",
      ].join("\n"),
    );
  }

  const env = parseEnvFile(envFilePath);

  // The env file is checked on its own, and the target's own origins are
  // checked too, so neither a prod-pointing env file nor a prod-pointing table
  // entry can smuggle production in past the other.
  const found = [
    ...findProduction(env, PRODUCTION_CHECKED_KEYS, (key) => `${target.envFile}  ${key}`),
    ...findProduction(
      { webOrigin: target.webOrigin, apiOrigin: target.apiOrigin },
      TARGET_ORIGIN_KEYS,
      (key) => `E2E_TARGET=${name}  ${key}`,
    ),
  ];
  if (found.length > 0) {
    throw new E2ETargetError(
      [
        `E2E_TARGET=${name} resolves to production. Refusing to start.`,
        "",
        ...found.map(([label, value, marker]) => `  ${label}  →  ${value}  (${marker})`),
        "",
        "The E2E suite writes rows, runs the reminder scheduler, and deletes auth",
        "users. Choose a target whose env file does not point at production.",
      ].join("\n"),
    );
  }

  return {
    name: name as E2ETargetName,
    envFile: target.envFile,
    envFilePath,
    webOrigin: target.webOrigin,
    apiOrigin: target.apiOrigin,
    webPort: target.webPort,
    apiPort: target.apiPort,
    env,
  };
}

/**
 * The environment the suite runs in: the target's variables plus the host-level
 * ones Bun and Next need, and nothing else.
 *
 * `NODE_ENV` is dropped rather than inherited. A stray `NODE_ENV=production` in
 * the developer's shell would put the API into production mode, where
 * `assertStartupConfig` (`apps/api/src/env.ts:19`) demands `CRON_SECRET`,
 * `AUTH_BRIDGE_SECRET`, and `REDIS_URL`, cookies are issued `secure`, and the
 * production-only schema and Resend checks run. A staging run must not be in
 * that mode. The `E2E_*` overrides the old config honoured are dropped so a
 * stale shell value cannot aim the browser or the fixtures somewhere other than
 * the chosen target.
 */
export function targetEnv(
  target: E2ETarget,
  source: Record<string, string | undefined> = process.env,
): Record<string, string> {
  const env: Record<string, string> = {};

  for (const key of PASSTHROUGH_KEYS) {
    const value = source[key];
    if (value !== undefined) env[key] = value;
  }

  for (const [key, value] of Object.entries(target.env)) {
    if (key === "NODE_ENV" || REMOVED_OVERRIDE_KEYS.includes(key as never)) continue;
    env[key] = value;
  }

  // Re-asserted rather than inherited: every worker process re-imports this
  // config and resolves its own target, and that resolution is what stops a
  // production run. Replaced by the canonical name, never by a shell value.
  env.E2E_TARGET = target.name;

  // The target decides the origins, not the env file: a stale WEB_ORIGIN in the
  // env file must not point the API's CORS allow-list somewhere else.
  env.API_ORIGIN = target.apiOrigin;
  env.WEB_ORIGIN = target.webOrigin;
  env.API_PORT = String(target.apiPort);

  return env;
}

/**
 * Replace the current process environment with the target's.
 *
 * Mutates in place rather than assigning `process.env` so the object identity
 * stays stable for everything that reads it afterwards (the runner, the specs,
 * and every `webServer` child it spawns).
 */
export function applyRunnerEnv(
  target: E2ETarget,
  source: Record<string, string | undefined> = process.env,
): void {
  const next = targetEnv(target, source);
  for (const key of Object.keys(process.env)) delete process.env[key];
  Object.assign(process.env, next);
}
