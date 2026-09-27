#!/usr/bin/env bun
/**
 * verify-routes.ts — fail the build when a route's render mode drifts.
 *
 * Regression gate for the 2026-09-27 outage: removing `force-dynamic`
 * from an interactive auth page flips it to static, the Suspense boundary
 * bails to an empty fallback at prerender, and (under hash-CSP) the form
 * never appears — while build/typecheck/tests all stay green.
 *
 * This reads `.next/prerender-manifest.json` (definitive, not log parsing):
 * - STATIC_EXPECTED must be prerendered (present in `routes`).
 * - DYNAMIC_EXPECTED must NOT be prerendered (absent from `routes`).
 *
 * Usage: `bun scripts/verify-routes.ts` (wired into `bun run build`).
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const WEB_ROOT = join(import.meta.dir, "..");

/** Fully static, complete prerender (hash-CSP allowlist in build-csp-hashes.ts). */
const STATIC_EXPECTED = ["/"];

/**
 * Interactive or session-gated: MUST render per request. If any of these
 * ever shows up as prerendered, an interactive boundary may have bailed
 * silently — fail loudly instead of shipping it.
 */
const DYNAMIC_EXPECTED = [
  "/login",
  "/register",
  "/forgot-password",
  "/reset-password",
  "/summary",
  "/tasks",
  "/calendar",
  "/courses",
  "/settings",
  "/learn",
];

export function checkRoutes(
  manifestRoutes: Record<string, unknown>,
): string[] {
  const violations: string[] = [];
  for (const route of STATIC_EXPECTED) {
    if (!(route in manifestRoutes)) {
      violations.push(
        `expected static but prerender missing: ${route} (not in prerender-manifest routes)`,
      );
    }
  }
  for (const route of DYNAMIC_EXPECTED) {
    if (route in manifestRoutes) {
      violations.push(
        `expected dynamic but prerendered static: ${route} — an interactive ` +
          `or session-gated page must never prerender (see 2026-09-27 login outage). ` +
          `Restore \`export const dynamic = "force-dynamic"\`.`,
      );
    }
  }
  return violations;
}

function main(): void {
  const manifestPath = join(WEB_ROOT, ".next", "prerender-manifest.json");
  if (!existsSync(manifestPath)) {
    throw new Error(
      `[verify-routes] ${manifestPath} not found — run after \`next build\`.`,
    );
  }
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as {
    routes?: Record<string, unknown>;
  };
  const violations = checkRoutes(manifest.routes ?? {});
  if (violations.length > 0) {
    console.error("[verify-routes] FAILED:");
    for (const v of violations) console.error(`  - ${v}`);
    process.exit(1);
  }
  console.log(
    `[verify-routes] ok — ${STATIC_EXPECTED.length} static, ${DYNAMIC_EXPECTED.length} dynamic as expected.`,
  );
}

if (import.meta.main) {
  main();
}
