import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Locks in the unit/DB test split (#69).
 *
 * ci-dev.yml documents "no database, no secrets — unit tests only", but the
 * db `test` script used to run every src/*.test.ts including the DB guards
 * (SEC-003, RLS matrix, drift, …), which need a migrated Postgres and turned
 * the dev gate red. The split:
 *   - `test`    → DB-free unit tests only (runs in ci-dev AND ci-main)
 *   - `test:db` → live-database guards (runs in ci-main after migrations)
 *
 * This meta-test fails if a src/*.test.ts file is listed in neither script
 * (silently skipped everywhere) or in both (DB guard leaking into ci-dev).
 */
const here = dirname(fileURLToPath(import.meta.url));
const pkg = JSON.parse(
  readFileSync(join(here, "..", "package.json"), "utf8"),
) as { scripts: Record<string, string> };

function listedFiles(script: string): string[] {
  return (pkg.scripts[script] ?? "")
    .split(/\s+/)
    .filter((token) => token.endsWith(".test.ts"))
    .map((token) => token.split("/").pop() as string);
}

describe("test target split (ci-dev has no database)", () => {
  test("every src/*.test.ts is listed in exactly one of test / test:db", () => {
    const onDisk = readdirSync(here).filter((file) =>
      file.endsWith(".test.ts"),
    );
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
