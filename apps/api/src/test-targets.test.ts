import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Locks in the unit/DB test split (#69).
 *
 * ci-dev.yml documents "no database, no secrets — unit tests only", but the
 * api `test` script used to run every src test including the real-database
 * suites (registration RBAC flow, RLS claims context, summary RPC
 * equivalence), which need a migrated Postgres and turned the dev gate red
 * (exit 1, no summary — the process dies on the failed connection).
 * The split:
 *   - `test`    → DB-free unit tests only (runs in ci-dev AND ci-main)
 *   - `test:db` → live-database suites (runs in ci-main after migrations)
 *
 * This meta-test fails if a src test file is listed in neither script
 * (silently skipped everywhere) or in both (DB suite leaking into ci-dev).
 */
const here = dirname(fileURLToPath(import.meta.url));

function collect(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      out.push(...collect(full));
    } else if (entry.endsWith(".test.ts")) {
      out.push(`src/${full.slice(here.length + 1)}`);
    }
  }
  return out;
}

const pkg = JSON.parse(
  readFileSync(join(here, "..", "package.json"), "utf8"),
) as { scripts: Record<string, string> };

function listedFiles(script: string): string[] {
  return (pkg.scripts[script] ?? "")
    .split(/\s+/)
    .filter((token) => token.endsWith(".test.ts"));
}

describe("test target split (ci-dev has no database)", () => {
  test("every src test file is listed in exactly one of test / test:db", () => {
    const onDisk = collect(here);
    const unit = listedFiles("test");
    const db = listedFiles("test:db");
    expect(onDisk.length).toBeGreaterThan(0);
    for (const file of onDisk) {
      const inUnit = unit.includes(file);
      const inDb = db.includes(file);
      expect(
        inUnit !== inDb,
        `${file} must be in exactly one of test / test:db (unit=${inUnit}, db=${inDb})`,
      ).toBe(true);
    }
    for (const file of [...unit, ...db]) {
      expect(
        onDisk.includes(file),
        `${file} is listed in package.json but missing on disk`,
      ).toBe(true);
    }
  });
});
