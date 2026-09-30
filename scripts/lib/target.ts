/**
 * Explicit-target guard for local tooling (#63).
 *
 * Generalises the E2E resolver (`apps/e2e/target.ts`, #56): no script a
 * developer or agent runs locally may resolve a production database or auth
 * target by accident. Every script that touches a database, auth, or external
 * service resolves its target explicitly through this module and fails closed
 * when the target is missing; a production target is refused unless it is
 * named explicitly *and* deliberately (`--allow-production` on the command
 * line — never an environment variable, never a default).
 *
 * Refusal messages name keys and files only. Values are never printed: a
 * refusal that echoes a value puts the secret in CI logs and scrollback.
 */

import { readFileSync } from "node:fs";

/**
 * Production identifiers, sourced from the root `.env.production`
 * (DATABASE_URL / SUPABASE_URL, WEB_ORIGIN / API_ORIGIN). Matched as
 * substrings: a deny list that over-matches is safe, one that under-matches
 * reaches production.
 *
 * Canonical copy. `apps/e2e/target.ts` re-exports this list so the two never
 * drift.
 */
export const PRODUCTION_MARKERS = [
  "bhtfkuzsdxrdmvvcczse", // production Supabase project ref
  "bhtfkuzsdxrdmvvcczse.supabase.co",
  "deadline-radar-web.vercel.app",
  "deadline-radar-api-production.up.railway.app",
] as const;

/** Env keys whose value decides which database/auth a script writes to. */
export const TARGET_ENV_KEYS = [
  "DATABASE_URL",
  "DIRECT_URL",
  "SUPABASE_URL",
  "NEXT_PUBLIC_SUPABASE_URL",
  "WEB_ORIGIN",
  "API_ORIGIN",
] as const;

/** Thrown for every refusal. Carries the message the operator should read. */
export class ScriptTargetError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ScriptTargetError";
  }
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

/** `[key, marker]` for every checked key whose value hits the deny list. */
export function findProductionRefs(
  env: Record<string, string | undefined>,
  keys: readonly string[] = TARGET_ENV_KEYS,
): [string, string][] {
  const found: [string, string][] = [];
  for (const key of keys) {
    const value = env[key];
    if (!value) continue;
    const marker = PRODUCTION_MARKERS.find((candidate) => value.includes(candidate));
    if (marker) found.push([key, marker]);
  }
  return found;
}

/**
 * Refuse to continue when the current environment points at production.
 *
 * Production is reachable only deliberately: pass `allowProduction: true`
 * (wired by callers to an explicit `--allow-production` CLI flag). There is
 * no environment-variable override — a stale shell value must never make a
 * production run the easy option.
 */
export function assertNoProductionEnv(
  env: Record<string, string | undefined> = process.env,
  options: { context?: string; allowProduction?: boolean; productionHint?: string } = {},
): void {
  if (options.allowProduction) return;
  const found = findProductionRefs(env);
  if (found.length === 0) return;

  const context = options.context ?? "this script";
  const productionHint =
    options.productionHint ??
    "Run against staging instead (e.g. bun run dev:staging), or pass\n--allow-production to name production explicitly and deliberately.";
  throw new ScriptTargetError(
    [
      `Refusing: the current environment points at production, and ${context} was`,
      "not given an explicit production target.",
      "",
      ...found.map(([key, marker]) => `  ${key} matches a production reference (${marker})`),
      "",
      "Only key names are shown; values are never printed.",
      productionHint,
    ].join("\n"),
  );
}

/**
 * Fail closed when a required variable is missing, naming it.
 */
export function requireEnv(
  name: string,
  env: Record<string, string | undefined> = process.env,
): string {
  const value = env[name];
  if (!value) throw new ScriptTargetError(`${name} is required but is not set.`);
  return value;
}

/**
 * Extract the Supabase project ref from a URL. Matches the pooler
 * (`postgres.<ref>`), direct (`db.<ref>.supabase.co`), and dashboard
 * (`<ref>.supabase.co`) shapes.
 */
export const projectRef = (value: string): string | null =>
  value.match(/postgres\.([a-z]{20})[:@]/)?.[1] ??
  value.match(/@db\.([a-z]{20})\.supabase\.co/)?.[1] ??
  value.match(/^https?:\/\/([a-z]{20})\.supabase\.co/)?.[1] ??
  null;

/**
 * Generalised staging guard (was inline in `scripts/dev.ts`): the Supabase
 * project ref in DATABASE_URL must match the one in SUPABASE_URL. A mixed
 * env file (staging keys + production pooler, or the reverse) writes to the
 * wrong database and is otherwise invisible.
 */
export function assertRefsMatch(
  env: Record<string, string | undefined> = process.env,
  sourceLabel = "the current environment",
): void {
  const dbRef = projectRef(env.DATABASE_URL ?? "");
  const urlRef = projectRef(env.SUPABASE_URL ?? "");
  if (dbRef && urlRef && dbRef !== urlRef) {
    throw new ScriptTargetError(
      [
        "Refusing: DATABASE_URL and SUPABASE_URL point at different",
        `Supabase projects (${dbRef} vs ${urlRef}) in ${sourceLabel}.`,
        "Pick one project per env file.",
      ].join("\n"),
    );
  }
}

/**
 * Shared DATABASE_URL resolution for migration, status, verify, and drift
 * commands (was duplicated in `scripts/migrate.ts` and
 * `scripts/verify-schema-drift.ts`). Fails closed on a missing value and on
 * production, unless production was named deliberately.
 */
export function getDatabaseUrl(
  env: Record<string, string | undefined> = process.env,
  options: { allowProduction?: boolean } = {},
): string {
  const url = env.DATABASE_URL || env.DIRECT_URL;
  if (!url) {
    throw new ScriptTargetError(
      "DATABASE_URL is required but is not set. Run with an explicit env file, e.g. bun --env-file=.env.staging …",
    );
  }
  // Production is refused before the URL is used for anything.
  assertNoProductionEnv(env, { context: "this database command", allowProduction: options.allowProduction });
  // If connecting to local postgres without sslmode specified, add sslmode=disable
  if ((url.includes("localhost") || url.includes("127.0.0.1")) && !url.includes("sslmode=")) {
    const separator = url.includes("?") ? "&" : "?";
    return `${url}${separator}sslmode=disable`;
  }
  return url;
}

/** Host-only summary for logs: never a credential, never a full URL. */
export function describeDbHost(env: Record<string, string | undefined> = process.env): string {
  const raw = env.SUPABASE_URL ?? env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  try {
    const host = new URL(raw).host;
    if (host) return host;
  } catch {
    // Malformed URL: report unknown instead of crashing the caller.
  }
  return "(unknown — SUPABASE_URL missing or malformed)";
}
