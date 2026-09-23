import { afterAll, describe, expect, test } from "bun:test";
import { fileURLToPath } from "node:url";
import type { Sql } from "postgres";
import { postgres } from "./client";

/**
 * F-1: RLS enforced as the end-user role (bun-level row-visibility probes).
 *
 * Why this file exists: schema-drift.test.ts only asserts policy NAMES exist
 * (rlsEnabled==12, policies==18). It stays green when a policy USING/WITH
 * CHECK predicate is dropped, when DELETE is accidentally allowed, or when a
 * SECURITY DEFINER view bypasses RLS. Every route test mocks getDb, so no bun
 * test ever executed a query as `authenticated` — until this file.
 *
 * BYPASSRLS trap: the test DATABASE_URL role is a superuser (bypasses RLS),
 * exactly like service_role. Probes MUST therefore `SET LOCAL ROLE
 * authenticated` + set the request.jwt.claim.* GUCs (the same claims
 * withUserRls sets) — otherwise SELECTs silently see all tenants and the
 * test cannot fail. SET LOCAL is transaction-scoped, so every probe runs
 * inside sql.begin(); fixtures are rolled back via a sentinel error, leaving
 * zero rows behind.
 *
 * The full per-op matrix lives in supabase/tests/rls_matrix.sql (also run by
 * CI via psql); the last test below executes that same file through
 * sql.file() so the dev loop (`bun test`) covers it too.
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

const MATRIX_SQL_PATH = fileURLToPath(
  new URL("../../../supabase/tests/rls_matrix.sql", import.meta.url),
);

interface Fixtures {
  userA: string;
  userB: string;
  courseA: string;
  courseB: string;
  taskA: string;
  taskB: string;
  thrA: string;
  thrB: string;
}

type Tx = Sql;

async function createFixtures(tx: Tx): Promise<Fixtures> {
  // Client-simulation grant: real Supabase grants USAGE ON SCHEMA auth to
  // anon/authenticated; without it, trigger-internal auth.* calls fail as
  // `authenticated` with "permission denied for schema auth" (idempotent).
  await tx`grant usage on schema auth to anon, authenticated, service_role`;

  const users =
    await tx<{ id: string }[]>`insert into auth.users (email) values ('rls-bun-a@example.invalid'), ('rls-bun-b@example.invalid') returning id`;
  const userA = users[0].id;
  const userB = users[1].id;

  const courses = await tx<{ id: string }[]>`
    insert into public.courses (user_id, name)
    values (${userA}, 'RLS Bun Course A'), (${userB}, 'RLS Bun Course B')
    returning id
  `;
  const courseA = courses[0].id;
  const courseB = courses[1].id;

  const tasks = await tx<{ id: string }[]>`
    insert into public.tasks (user_id, course_id, title, deadline)
    values (${userA}, ${courseA}, 'RLS Bun Task A', now() + interval '1 day'),
           (${userB}, ${courseB}, 'RLS Bun Task B', now() + interval '1 day')
    returning id
  `;
  const taskA = tasks[0].id;
  const taskB = tasks[1].id;

  // Custom days_before avoids colliding with the 7/3/1/0 auto defaults.
  const thrs = await tx<{ id: string }[]>`
    insert into public.reminder_thresholds (task_id, days_before, is_default)
    values (${taskA}, 30, false), (${taskB}, 30, false)
    returning id
  `;

  return {
    userA,
    userB,
    courseA,
    courseB,
    taskA,
    taskB,
    thrA: thrs[0].id,
    thrB: thrs[1].id,
  };
}

/** Become tenant `userId` for subsequent statements in this transaction. */
async function becomeUser(tx: Tx, userId: string): Promise<void> {
  const claims = JSON.stringify({ sub: userId, role: "authenticated" });
  await tx`select set_config('request.jwt.claim.sub', ${userId}, true)`;
  await tx`select set_config('request.jwt.claim.role', 'authenticated', true)`;
  await tx`select set_config('request.jwt.claims', ${claims}, true)`;
  await tx.unsafe("SET LOCAL ROLE authenticated");
}

async function resetToOwner(tx: Tx): Promise<void> {
  await tx.unsafe("RESET ROLE");
}

async function withRlsFixtures(
  sql: Sql,
  fn: (tx: Sql, fx: Fixtures) => Promise<void>,
): Promise<void> {
  // A reserved connection allows explicit BEGIN/ROLLBACK plus SET LOCAL
  // ROLE / SAVEPOINT, which postgres.js forbids on pooled connections.
  // Fixtures are always rolled back: the database is unchanged afterwards.
  const reserved = await sql.reserve();
  try {
    await reserved.unsafe("BEGIN");
    try {
      const fx = await createFixtures(reserved);
      await fn(reserved, fx);
    } finally {
      await reserved.unsafe("ROLLBACK");
    }
  } finally {
    reserved.release();
  }
}

/**
 * Run a write expected to be denied by RLS. A failed statement aborts the
 * surrounding transaction, so the probe runs inside a SAVEPOINT that is
 * rolled back afterwards; the denial error message is returned.
 */
async function expectRlsDenied(
  tx: Sql,
  probe: () => Promise<unknown>,
): Promise<string> {
  await tx.unsafe("SAVEPOINT rls_probe");
  try {
    await probe();
  } catch (e) {
    await tx.unsafe("ROLLBACK TO SAVEPOINT rls_probe");
    return String(e);
  }
  await tx.unsafe("RELEASE SAVEPOINT rls_probe");
  throw new Error("RLS probe WAS ALLOWED (expected denial)");
}

describe("F-1 RLS as the end-user role", () => {
  const dbUrl = getTestDbUrl();
  const sql = postgres(dbUrl, {
    prepare: false,
    max: 2,
    connect_timeout: 5,
    // The matrix raises NOTICE on every pass; keep bun output readable.
    onnotice: () => {},
  });

  afterAll(async () => {
    await sql.end();
  });

  test("rls tasks SELECT isolates tenants", async () => {
    await withRlsFixtures(sql, async (tx, fx) => {
      await becomeUser(tx, fx.userA);
      const rows = await tx<{ id: string; user_id: string }[]>`select id, user_id from public.tasks`;
      expect(rows.length).toBe(1);
      expect(rows[0].user_id).toBe(fx.userA);
      expect(rows.some((r) => r.id === fx.taskB)).toBe(false);

      await becomeUser(tx, fx.userB);
      const rowsB = await tx<{ id: string; user_id: string }[]>`select id, user_id from public.tasks`;
      expect(rowsB.length).toBe(1);
      expect(rowsB[0].user_id).toBe(fx.userB);
      expect(rowsB.some((r) => r.id === fx.taskA)).toBe(false);
    });
  });

  test("rls tasks INSERT WITH CHECK blocks cross-tenant write", async () => {
    await withRlsFixtures(sql, async (tx, fx) => {
      await becomeUser(tx, fx.userA);
      const before =
        await tx<{ n: string }[]>`select count(*)::text as n from public.tasks`;
      expect(before[0].n).toBe("1");

      const err = await expectRlsDenied(
        tx,
        () =>
          tx`insert into public.tasks (user_id, course_id, title, deadline)
            values (${fx.userB}, ${fx.courseB}, 'RLS Bun Smuggle', now() + interval '1 day')`,
      );
      expect(err).toMatch(/row-level security/i);

      const after =
        await tx<{ n: string }[]>`select count(*)::text as n from public.tasks`;
      expect(after[0].n).toBe("1");
    });
  });

  test("rls is enabled on every tenant table", async () => {
    const expected = [
      "profiles",
      "courses",
      "tasks",
      "reminder_thresholds",
      "notification_deliveries",
      "attachments",
      "auth_audit_events",
      "roles",
      "role_capabilities",
      "user_roles",
      "idempotency_keys",
      "reminder_runs",
    ].sort();
    const rows = await sql<{ relname: string }[]>`
      select c.relname from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relkind = 'r' and c.relrowsecurity
      order by c.relname
    `;
    expect(rows.map((r) => r.relname)).toEqual(expected);

    // Any public table WITHOUT RLS is a tenant-isolation hole: fail loudly
    // so a newly added table cannot ship without an explicit RLS decision.
    const unprotected = await sql<{ relname: string }[]>`
      select c.relname from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity
    `;
    expect(unprotected.length).toBe(0);
  });

  test("per-op matrix: courses DELETE must fail, cross-tenant writes denied", async () => {
    await withRlsFixtures(sql, async (tx, fx) => {
      await becomeUser(tx, fx.userA);

      // courses DELETE: no policy -> 0 rows even for the own row (hard
      // delete forbidden; app soft-deletes via UPDATE deleted_at).
      const del =
        await tx`delete from public.courses where id = ${fx.courseA}`;
      expect(del.count).toBe(0);

      // courses UPDATE cross-tenant: invisible -> 0 rows.
      const updCross =
        await tx`update public.courses set name = 'smuggle' where id = ${fx.courseB}`;
      expect(updCross.count).toBe(0);

      // tasks DELETE: no policy -> 0 rows.
      const delTask =
        await tx`delete from public.tasks where id = ${fx.taskA}`;
      expect(delTask.count).toBe(0);

      // thresholds DELETE: no policy (RF-09 archives via UPDATE deleted_at),
      // so even the own row is unaffected; cross-tenant is 0 rows too.
      const delThr =
        await tx`delete from public.reminder_thresholds where id = ${fx.thrB}`;
      expect(delThr.count).toBe(0);

      // deliveries INSERT: no policy for authenticated (scheduler uses
      // service_role) -> RLS violation.
      const delErr = await expectRlsDenied(
        tx,
        () =>
          tx`insert into public.notification_deliveries (task_id, threshold_id, days_before, channel)
            values (${fx.taskA}, ${fx.thrA}, 30, 'in_app')`,
      );
      expect(delErr).toMatch(/row-level security/i);

      // Zero-policy tables are invisible to authenticated.
      for (const table of [
        "roles",
        "auth_audit_events",
        "idempotency_keys",
        "reminder_runs",
      ]) {
        const rows = await tx.unsafe(
          `select count(*)::text as n from public.${table}`,
        );
        expect((rows as unknown as { n: string }[])[0].n).toBe("0");
      }

      // Back as owner: denied writes left no trace.
      await resetToOwner(tx);
      const course =
        await tx<{ name: string }[]>`select name from public.courses where id = ${fx.courseA}`;
      expect(course.length).toBe(1);
      const task =
        await tx<{ title: string }[]>`select title from public.tasks where id = ${fx.taskB}`;
      expect(task[0].title).toBe("RLS Bun Task B");
    });
  });

  test("full rls_matrix.sql passes as the end-user role", async () => {
    // Authoritative per-op matrix (allow+deny for S/I/U/D on every tenant
    // table, exact 12-table RLS set, 18-policy set, no public views,
    // SECURITY DEFINER allowlist). Raises on the first violation; the file
    // rolls back its own fixtures, so the database is unchanged. Runs on a
    // reserved connection because the file contains its own BEGIN/ROLLBACK.
    const reserved = await sql.reserve();
    try {
      await reserved.file(MATRIX_SQL_PATH);
    } finally {
      reserved.release();
    }
  }, 60000);
});
