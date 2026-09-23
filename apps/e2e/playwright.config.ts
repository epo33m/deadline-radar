import { defineConfig } from "@playwright/test";
import { fileURLToPath } from "node:url";
import path from "node:path";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "../..");

// Load the same env the dev scripts use (root .env.local). Never commit secrets;
// webServer children inherit process.env, so API + web boot with real config.
if (typeof process.loadEnvFile === "function") {
  process.loadEnvFile(path.join(repoRoot, ".env.local"));
}

const API_PORT = Number(process.env.API_PORT ?? 4025);
const WEB_PORT = Number(process.env.E2E_WEB_PORT ?? 3025);
const API_ORIGIN = process.env.API_ORIGIN ?? `http://127.0.0.1:${API_PORT}`;
const WEB_ORIGIN = `http://127.0.0.1:${WEB_PORT}`;

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
    baseURL: process.env.E2E_WEB_ORIGIN ?? WEB_ORIGIN,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    // Fail fast instead of hanging: dev-server compiles are covered by the
    // 90s test timeout + 15s expect timeout; actions get the same budget.
    actionTimeout: 15_000,
  },
  webServer: [
    {
      // Real API over real HTTP + real database. No mocks, no app.handle().
      command: "bun src/index.ts",
      cwd: path.join(repoRoot, "apps/api"),
      url: `${API_ORIGIN}/health`,
      timeout: 120_000,
      reuseExistingServer: !process.env.CI,
      stdout: "pipe",
      stderr: "pipe",
    },
    {
      // Real Next.js web app. PRODUCTION server (`next start`), not dev:
      // `next dev` (Turbopack) does not hydrate in this sandbox's headless
      // Chromium (SSR HTML serves, but no client runtime ever attaches), while
      // the production bundle hydrates correctly. Production is also the more
      // faithful E2E target. Prerequisite: build the web app first
      // (`bun run build` from the repo root, or `pretest:e2e` does it).
      // Server Components, Server Actions, and rendered HTML are all
      // production code paths, not test doubles.
      command: `bunx next start --port ${WEB_PORT}`,
      cwd: path.join(repoRoot, "apps/web"),
      url: `${WEB_ORIGIN}/login`,
      timeout: 60_000,
      reuseExistingServer: !process.env.CI,
      stdout: "pipe",
      stderr: "pipe",
      env: {
        API_ORIGIN,
        WEB_ORIGIN,
      },
    },
  ],
});
