import { defineConfig } from "@playwright/test";
import path from "node:path";

import { applyRunnerEnv, E2ETargetError, repoRoot, resolveTarget } from "./target";

// The suite never chooses its own target: E2E_TARGET names one, the env file
// that target declares is the only env source, and a target that resolves to a
// production host is refused outright. See ./target.ts.
let target;
try {
  target = resolveTarget();
} catch (error) {
  if (error instanceof E2ETargetError) {
    console.error(`\n✗ ${error.message}\n`);
    process.exit(1);
  }
  throw error;
}

// Playwright launches `webServer` children as
// `{ ...defaults, ...process.env, ...server.env }` (playwright/lib/runner), so
// the runner environment is the boundary — anything left in it reaches the API
// and web processes. Narrowing it to the target is what keeps a production
// secret out of a non-production run.
applyRunnerEnv(target);

console.log(
  `\n  e2e target: ${target.name} → ${target.webOrigin} (env: ${target.envFile})\n`,
);

export default defineConfig({
  testDir: "./tests",
  // Serial: one worker => deterministic order + stays far below API rate limits
  // (auth-sensitive bucket is 20 req/min shared per client key).
  workers: 1,
  fullyParallel: false,
  timeout: 90_000,
  expect: { timeout: 15_000 },
  retries: 0,
  reporter: [["list"], ["html", { open: "never" }]],
  use: {
    baseURL: target.webOrigin,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    // Fail fast instead of hanging: dev-server compiles are covered by the
    // 90s test timeout + 15s expect timeout; actions get the same budget.
    actionTimeout: 15_000,
  },
  webServer: [
    {
      // Real API over real HTTP + real database. No mocks, no app.handle().
      // `env` is merged over the runner env, which already holds exactly the
      // target's variables.
      command: "bun src/index.ts",
      cwd: path.join(repoRoot, "apps/api"),
      url: `${target.apiOrigin}/health`,
      timeout: 120_000,
      // Never adopt a server that is already listening: we cannot tell which
      // target it was booted against, and a suite that quietly tests someone
      // else's stack is exactly the failure this ticket closes.
      reuseExistingServer: false,
      stdout: "pipe",
      stderr: "pipe",
      env: { API_ORIGIN: target.apiOrigin, WEB_ORIGIN: target.webOrigin },
    },
    {
      // Real Next.js web app. PRODUCTION server (`next start`), not dev:
      // `next dev` (Turbopack) does not hydrate in this sandbox's headless
      // Chromium (SSR HTML serves, but no client runtime ever attaches), while
      // the production bundle hydrates correctly. Production is also the more
      // faithful E2E target. Prerequisite: build the web app first
      // (`bun run build` from the repo root, or `pretest:e2e` does it — it
      // resolves the same target so the baked API_ORIGIN rewrite matches).
      // Server Components, Server Actions, and rendered HTML are all
      // production code paths, not test doubles.
      command: `bunx next start --port ${target.webPort}`,
      cwd: path.join(repoRoot, "apps/web"),
      url: `${target.webOrigin}/login`,
      timeout: 60_000,
      reuseExistingServer: false,
      stdout: "pipe",
      stderr: "pipe",
      env: { API_ORIGIN: target.apiOrigin, WEB_ORIGIN: target.webOrigin },
    },
  ],
});
