/**
 * Run a command with the E2E target's environment.
 *
 * Needed because `apps/web/next.config.ts` reads API_ORIGIN at *build* time and
 * bakes it into the `/api/:path*` rewrites, so the web build has to be resolved
 * against the same target as the run. Passing a different API_ORIGIN to
 * `next start` later does not change those rewrites.
 *
 * Refuses exactly as `playwright.config.ts` does: no E2E_TARGET, an unknown
 * E2E_TARGET, a missing env file, a target that resolves to production, or a
 * production credential sitting in the Next app directory.
 */
import path from "node:path";

import { assertNoProductionAppEnv } from "../app-env";
import { E2ETargetError, repoRoot, resolveTarget, targetEnv } from "../target";

let target;
try {
  target = resolveTarget();
  // Before any process exists: `next build` loads the app dir's own env files,
  // so a sanitised environment alone cannot keep a credential out of it.
  assertNoProductionAppEnv();
} catch (error) {
  if (error instanceof E2ETargetError) {
    console.error(`\n✗ ${error.message}\n`);
    process.exit(1);
  }
  throw error;
}

// `bun run <script> -- a b c` may or may not keep the separator in argv.
const argv = process.argv.slice(2).filter((arg) => arg !== "--");
if (argv.length === 0) {
  console.error("\n✗ with-target-env: no command given.\n  usage: with-target-env -- <command> [args…]\n");
  process.exit(1);
}

console.log(`  e2e target: ${target.name} → ${target.webOrigin} (env: ${target.envFile})\n`);

// Run from the repo root so `nx` resolves the project graph, and put the root
// bin directory on PATH because that is where `nx` lives (the wrapper is
// invoked from the apps/e2e workspace, whose own .bin does not have it).
const rootBin = path.join(repoRoot, "node_modules", ".bin");
const env = targetEnv(target);
env.PATH = env.PATH ? `${rootBin}:${env.PATH}` : rootBin;

const child = Bun.spawn({
  cmd: argv,
  cwd: repoRoot,
  env,
  stdout: "inherit",
  stderr: "inherit",
  stdin: "inherit",
});

process.exit(await child.exited);
