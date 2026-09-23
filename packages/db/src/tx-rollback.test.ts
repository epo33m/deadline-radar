import { afterAll, describe, expect, test } from "bun:test";
import type { Sql } from "postgres";
import { postgres } from "./client";

/**
 * F-8: mid-transaction DB failure rolls everything back (real PostgreSQL).
 *
 * Mocked-db suites can only simulate rollback (snapshot-restore in a fake
 * `transaction`); this file proves drizzle + PostgreSQL atomicity on the
 * real schema: a multi-statement tx (auth user → course → task → threshold)
 * that dies on a foreign-key violation leaves ZERO rows behind — never a
 * task without its thresholds. Fixture emails are unique per run; the
 * rollback itself is the cleanup (plus a defensive delete).
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

describe("F-8 mid-tx DB failure rolls back (real tx)", () => {
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

  test("task+thresholds tx dying on FK violation leaves zero rows", async () => {
    const email = `f8-tx-${Date.now()}@example.invalid`;
    const BOGUS_TASK_ID = "00000000-0000-4000-8000-000000000000";

    let caught: unknown = null;
    try {
      await sql.begin(async (tx) => {
        const users = await tx<{ id: string }[]>`
          insert into auth.users (email) values (${email}) returning id`;
        const userId = users[0].id;
        const courses = await tx<{ id: string }[]>`
          insert into public.courses (user_id, name) values (${userId}, 'F-8 Course') returning id`;
        const tasks = await tx<{ id: string }[]>`
          insert into public.tasks (user_id, course_id, title, deadline)
          values (${userId}, ${courses[0].id}, 'F-8 Task', now() + interval '1 day')
          returning id`;
        // Deliberate FK violation: threshold for a task that does not exist.
        await tx`
          insert into public.reminder_thresholds (task_id, days_before, is_default)
          values (${BOGUS_TASK_ID}, 30, false)`;
        void tasks;
      });
    } catch (e) {
      caught = e;
    }
    expect(caught).not.toBeNull();
    expect(String(caught)).toMatch(/foreign key|23503/i);

    const users = await sql<{ n: string }[]>`
      select count(*)::text as n from auth.users where email = ${email}`;
    expect(users[0].n).toBe("0");
    const tasks = await sql<{ n: string }[]>`
      select count(*)::text as n from public.tasks where title = 'F-8 Task'`;
    expect(tasks[0].n).toBe("0");

    // Defensive cleanup (rollback above is the real cleanup; this only
    // guards against a future non-atomic path reusing this email).
    await sql`delete from auth.users where email = ${email}`;
  });
});
