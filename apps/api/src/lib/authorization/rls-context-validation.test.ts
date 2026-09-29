import { describe, expect, test } from "bun:test";
import { createDb } from "@deadline-radar/db";

import { withUserRls } from "./rls-context";

/**
 * DB-free input validation for withUserRls (#69).
 *
 * Extracted from rls-context.test.ts (a real-DB suite) so the database-less
 * dev gate keeps covering it. withUserRls throws on an empty userId before
 * touching any connection, so this never dials the database: the client
 * below is lazy and no query is ever issued. Must stay in the `test`
 * script, never in `test:db` (enforced by src/test-targets.test.ts).
 */
describe("withUserRls input validation (no DB)", () => {
  test("empty userId throws instead of stamping an anonymous context", async () => {
    const db = createDb("postgresql://localhost:5432/unused?sslmode=disable");
    await expect(withUserRls("", async () => {}, { db })).rejects.toThrow(
      "withUserRls requires a user id",
    );
  });
});
