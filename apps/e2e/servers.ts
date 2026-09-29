/**
 * The two processes the E2E suite starts.
 *
 * Extracted from `playwright.config.ts` so a test can build the *same* server
 * definitions and assert on the environment the web child is actually spawned
 * with, instead of restating it and drifting. Playwright merges
 * `{ ...defaults, ...process.env, ...server.env }` (playwright/lib/runner), so
 * `server.env` is the last word the suite has on a child's environment.
 */
import type { Config } from "@playwright/test";
import path from "node:path";

import { type E2ETarget, repoRoot } from "./target";

/**
 * The element type of `TestConfig["webServer"]`. Playwright 1.63 keeps
 * `TestConfigWebServer` unexported, so it is derived rather than imported: a
 * renamed or reshaped option becomes a type error here instead of a runtime
 * surprise in the runner.
 */
export type WebServerConfig = Extract<NonNullable<Config["webServer"]>, { command: string }>;

export function webServers(target: E2ETarget): WebServerConfig[] {
  return [
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
  ];
}

/** The web child's definition, by position. There are exactly two servers. */
export const WEB_SERVER = 1;
