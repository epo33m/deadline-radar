/**
 * The Next app directory is not an env source.
 *
 * `target.ts` already refuses a target whose env file points at production, and
 * `targetEnv()` already hands the web child a sanitised environment. Neither is
 * enough, because the web child re-reads the app directory after it starts:
 *
 *   - Next calls `loadEnvConfig(appDir)` in `next dev`, `next build`, and
 *     `next start`, which merges every file in `NEXT_AUTO_ENV_FILES` into
 *     `process.env` regardless of the environment the process was given.
 *   - Bun loads the same filenames from its cwd, so even a non-Next child run
 *     inside `apps/web` inherits them.
 *
 * A sanitised env is therefore necessary but not sufficient: the only reliable
 * place to stop a production credential is the file itself, before any process
 * starts. That is what this module does.
 *
 * #71: `apps/web/.env.local` was written by `vercel dev` and held
 * `VERCEL_OIDC_TOKEN`, a production deployment credential, which Next loaded
 * into the e2e web process. The token is now removed and this guard keeps it
 * from coming back unnoticed.
 */
import { existsSync } from "node:fs";
import path from "node:path";

import { E2ETargetError, parseEnvFile, PRODUCTION_MARKERS, repoRoot } from "./target";

/**
 * Every env file Next will auto-load from the app directory, in Next's own
 * precedence order. The union of both branches of `@next/env`'s `defaultEnvFiles`
 * (development picks the `.env.development*` set, everything else the
 * `.env.production*` set) — so the guard does not depend on which mode the
 * process happens to run in.
 */
export const NEXT_AUTO_ENV_FILES = [
  ".env.production.local",
  ".env.development.local",
  ".env.local",
  ".env.production",
  ".env.development",
  ".env",
] as const;

/**
 * Vercel keys that authorise something. `VERCEL_PROJECT_ID` and `VERCEL_ORG_ID`
 * are deliberately absent: they identify a project, grant nothing, and Vercel
 * injects them into every build. Refusing them would make this guard
 * indistinguishable from noise.
 */
export const VERCEL_CREDENTIAL_KEYS = [
  "VERCEL_OIDC_TOKEN",
  "VERCEL_TOKEN",
  "VERCEL_AUTOMATION_BYPASS_SECRET",
] as const;

export type AppEnvViolation = {
  /** Absolute path of the file, so the message is unambiguous. */
  file: string;
  key: string;
  reason: "credential" | "production-marker";
  /** The production identifier matched, for `production-marker`. */
  marker?: string;
};

function isCredentialKey(key: string): key is (typeof VERCEL_CREDENTIAL_KEYS)[number] {
  return (VERCEL_CREDENTIAL_KEYS as readonly string[]).includes(key);
}

/**
 * Scan the app directory for anything that must not be there. Returns one entry
 * per offending key, so a single file with three problems reports three.
 */
export function findAppEnvViolations(appDir: string): AppEnvViolation[] {
  const violations: AppEnvViolation[] = [];

  for (const name of NEXT_AUTO_ENV_FILES) {
    const file = path.join(appDir, name);
    if (!existsSync(file)) continue;

    // A malformed env file is a finding in itself: if it cannot be parsed, this
    // cannot tell whether it is clean, and reporting "clean" would be a guess.
    let env: Record<string, string>;
    try {
      env = parseEnvFile(file);
    } catch {
      violations.push({ file, key: "(unparseable)", reason: "credential" });
      continue;
    }

    for (const [key, value] of Object.entries(env)) {
      if (isCredentialKey(key)) {
        violations.push({ file, key, reason: "credential" });
        continue;
      }
      const marker = PRODUCTION_MARKERS.find((candidate) => value.includes(candidate));
      if (marker) violations.push({ file, key, reason: "production-marker", marker });
    }
  }

  return violations;
}

/**
 * Refuse to start if the app directory holds a production credential.
 *
 * Values are never included in the message: a refusal that prints the secret it
 * found puts the secret in CI logs and terminal scrollback.
 */
export function assertNoProductionAppEnv(appDir: string = path.join(repoRoot, "apps/web")): void {
  const violations = findAppEnvViolations(appDir);
  if (violations.length === 0) return;

  throw new E2ETargetError(
    [
      `${appDir} holds values that must not reach the e2e web process. Refusing to start.`,
      "",
      ...violations.map((violation) => {
        const detail =
          violation.reason === "credential"
            ? "Vercel credential"
            : `production identifier (${violation.marker})`;
        return `  ${violation.file}  ${violation.key}  → ${detail}`;
      }),
      "",
      "The web process is spawned with a sanitised environment, and that is not",
      "enough. Next calls loadEnvConfig(appDir) in dev, build, and start, and Bun",
      "loads the same files from its cwd — so anything here is merged into",
      "process.env no matter what the parent passed:",
      `  ${NEXT_AUTO_ENV_FILES.join(", ")}`,
      "",
      "Where these values belong instead:",
      "  - Vercel credentials: `vercel login` (the CLI keeps them in its own store,",
      "    never in this repo), or the project's Environment Variables in the",
      "    Vercel dashboard. The local `vercel dev` flow is not used any more.",
      "  - Local development values: the root `.env.local`, which the e2e suite",
      "    never reads.",
      "",
      "The values above are listed by key only; no value is printed.",
    ].join("\n"),
  );
}
