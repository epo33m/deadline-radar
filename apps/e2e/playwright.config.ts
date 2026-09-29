import { defineConfig } from "@playwright/test";

import { assertNoProductionAppEnv } from "./app-env";
import { webServers } from "./servers";
import { applyRunnerEnv, E2ETargetError, resolveTarget } from "./target";

// The suite never chooses its own target: E2E_TARGET names one, the env file
// that target declares is the only env source, and a target that resolves to a
// production host is refused outright. See ./target.ts.
//
// The app-directory guard is the second half of that: `applyRunnerEnv` below
// narrows the runner environment, but `next start` re-reads `apps/web`'s own env
// files, so a production credential there would survive the sanitising. See
// ./app-env.ts and #71.
let target;
try {
  target = resolveTarget();
  assertNoProductionAppEnv();
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
  webServer: webServers(target),
});
