#!/usr/bin/env bun
/**
 * sentry-drill.ts — prove Sentry ingestion end-to-end (C6 drill support).
 *
 * Sends one tagged error event through the project DSN and prints its ID.
 * Verify arrival in Sentry (Issues stream) — an alert that has never fired
 * is unproven, so every alert rule gets its drill via this script with a
 * distinct `--tag`.
 *
 * Usage:
 *   bun run scripts/sentry-drill.ts --dsn-env SENTRY_DSN --tag wiring [--message ...]
 * DSN envs resolve from process env first, then .env.production (operator file).
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import * as Sentry from "@sentry/bun";

const argv = process.argv.slice(2);
function flag(name: string): string | undefined {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : undefined;
}

const dsnEnv = flag("--dsn-env") ?? "SENTRY_DSN";
const tag = flag("--tag") ?? "wiring";
const message =
  flag("--message") ?? `drill: sentry-${tag}-${new Date().toISOString().slice(0, 10)}`;

function loadProdEnv(): void {
  // Operator file lives at the repo root (three levels up from this script:
  // scripts/ -> api/ -> apps/ -> root).
  const p = join(import.meta.dir, "..", "..", "..", ".env.production");
  if (!existsSync(p)) return;
  for (const line of readFileSync(p, "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Za-z_][\w]*)\s*=\s*(.*)\s*$/);
    if (!m || process.env[m[1]] !== undefined) continue;
    let v = m[2].trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
      v = v.slice(1, -1);
    }
    process.env[m[1]] = v;
  }
}
loadProdEnv();

const dsn = process.env[dsnEnv];
if (!dsn) {
  console.error(`[sentry-drill] missing env: ${dsnEnv}`);
  process.exit(1);
}

Sentry.init({ dsn, tracesSampleRate: 0 });
const eventId = Sentry.captureMessage(message, {
  level: "error",
  tags: { drill: tag },
});
await Sentry.flush(10000);
if (!eventId) {
  console.error("[sentry-drill] SDK did not produce an event id");
  process.exit(1);
}
console.log(`[sentry-drill] sent ${eventId} (tag drill=${tag}) — confirm in Sentry Issues.`);
