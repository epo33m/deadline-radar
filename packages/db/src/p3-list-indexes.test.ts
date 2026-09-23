import { afterAll, describe, expect, test } from "bun:test";
import { fileURLToPath } from "node:url";
import type { Sql } from "postgres";
import { postgres } from "./client";

/**
 * P3 index gaps (performance-audit-2026-09-20 §P3): task-scoped attachment
 * lookup + course-filtered task list. The migration
 * 20260921020000_p3_list_indexes.sql adds the indexes idempotently; the
 * authoritative existence + semantics matrix lives in
 * supabase/tests/p3_list_indexes_test.sql (also runnable via psql/CI).
 * This file executes that same script through sql.file() on a reserved
 * connection (the script manages its own BEGIN/ROLLBACK and leaves no rows
 * behind). Requires TEST_DATABASE_URL (or localhost test DB) like the
 * sec003/rls-matrix wrappers.
 */

function getTestDbUrl(): string {
  if (process.env.TEST_DATABASE_URL) {
    return process.env.TEST_DATABASE_URL;
  }
  const url = process.env.DATABASE_URL;
  if (url && !url.includes("supabase.co") && !url.includes("pooler.supabase.com")) {
    if ((url.includes("localhost") || url.includes("127.0.0.1")) && !url.includes("sslmode=")) {
      const sep = url.includes("?") ? "&" : "?";
      return `${url}${sep}sslmode=disable`;
    }
    return url;
  }
  return "postgresql://localhost:5432/test_verify_all?sslmode=disable";
}

const P3_SQL_PATH = fileURLToPath(
  new URL("../../../supabase/tests/p3_list_indexes_test.sql", import.meta.url),
);

describe("P3 list indexes (DB guard)", () => {
  const dbUrl = getTestDbUrl();
  const sql: Sql = postgres(dbUrl, {
    prepare: false,
    max: 2,
    connect_timeout: 5,
    onnotice: () => {},
  });

  afterAll(async () => {
    await sql.end();
  });

  test("p3_list_indexes_test.sql passes: index existence + query semantics", async () => {
    const reserved = await sql.reserve();
    try {
      // sql.file() speaks the wire protocol, not psql: resolve `\ir`
      // includes (relative to supabase/tests/, as psql would) so the same
      // script runs under both `bun test` and psql CI. The migration file
      // stays the single source of truth — nothing is duplicated here.
      const raw = await Bun.file(P3_SQL_PATH).text();
      const dir = P3_SQL_PATH.slice(0, P3_SQL_PATH.lastIndexOf("/"));
      const lines = raw.split("\n");
      const out: string[] = [];
      for (const line of lines) {
        const m = line.match(/^\s*\\ir\s+(\S+)\s*$/);
        if (m) {
          const inc = m[1].startsWith("/")
            ? m[1]
            : `${dir}/${m[1]}`.replace(/\/[^/]+\/\.\./, "");
          out.push(await Bun.file(inc).text());
        } else {
          out.push(line);
        }
      }
      await reserved.unsafe(out.join("\n"));
    } finally {
      reserved.release();
    }
    // Reaching here means every RAISE in the matrix stayed silent; any
    // violation rejects the promise and fails the test.
    expect(true).toBe(true);
  }, 120000);
});
