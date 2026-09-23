import { afterAll, describe, expect, test } from "bun:test";
import { fileURLToPath } from "node:url";
import type { Sql } from "postgres";
import { postgres } from "./client";

/**
 * SEC-003 / C4: DB quota backstop for direct PostgREST writes, in the dev loop.
 *
 * Application quotas (200 active tasks/user, 10 thresholds/task) are enforced
 * in the API, but RLS WITH CHECK has no count bound. The migration
 * 20260921000000_sec003_task_threshold_quota.sql adds BEFORE INSERT quota
 * triggers; the authoritative per-case matrix lives in
 * supabase/tests/sec003_quota.sql (also run by CI via psql). This file
 * executes that same script through sql.file() on a reserved connection
 * (the script manages its own BEGIN/ROLLBACK and leaves no rows behind).
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

const QUOTA_SQL_PATH = fileURLToPath(
  new URL("../../../supabase/tests/sec003_quota.sql", import.meta.url),
);

describe("SEC-003 direct-write quota backstop (DB guard)", () => {
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

  test("sec003_quota.sql passes: 200-task fill, 201st denied, thresholds, anon, bypass", async () => {
    const reserved = await sql.reserve();
    try {
      await reserved.file(QUOTA_SQL_PATH);
    } finally {
      reserved.release();
    }
    // Reaching here means every RAISE in the matrix stayed silent; any
    // violation rejects the promise and fails the test. Row counts are
    // asserted inside the script (including the post-rollback cleanup proof).
    expect(true).toBe(true);
  }, 120000);
});
