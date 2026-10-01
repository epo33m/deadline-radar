/**
 * #61 — the guardrail applies to every page the suite visits, not only one.
 *
 * Rule: any spec file that drives a browser (uses the `page` fixture or mints
 * its own pages/contexts) must import `test` from `./tests/guardrails` — the
 * fixture override that attaches the collector and fails on findings — rather
 * than from `@playwright/test`. API-only specs are unaffected by construction.
 *
 * The exemption annotation (`guardrails:intentional-error-page`) needs no
 * static check here: the fixture itself fails any test that pushes it without
 * a description, so an undocumented hole cannot pass.
 */
import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const testsDir = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "tests",
);

function specFiles(): string[] {
  return readdirSync(testsDir)
    .filter((entry) => entry.endsWith(".spec.ts"))
    .sort();
}

/** Heuristic for "drives a browser": page fixture, or pages minted by hand. */
function drivesBrowser(source: string): boolean {
  return (
    /\(\{\s*[^)]*\bpage\b/.test(source) ||
    source.includes("newPage(") ||
    source.includes("newContext(")
  );
}

function importsGuardedTest(source: string): boolean {
  return /from\s*["']\.\.?\/guardrails["']/.test(source);
}

describe("guardrails scope (#61)", () => {
  test("every browser-driven spec imports the guarded test", () => {
    const offenders: string[] = [];
    for (const file of specFiles()) {
      const source = readFileSync(path.join(testsDir, file), "utf8");
      if (drivesBrowser(source) && !importsGuardedTest(source)) {
        offenders.push(file);
      }
    }
    expect(
      offenders,
      "these specs drive a browser but import test from @playwright/test, " +
        "so no page they visit is guarded — import { test } from ./guardrails instead",
    ).toEqual([]);
  });
});
