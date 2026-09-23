process.env.NODE_ENV = "test";

import { describe, expect, test } from "bun:test";
import { createDb } from "@deadline-radar/db";
import { sql } from "drizzle-orm";

import { withUserRls } from "./rls-context";

/**
 * F-3: withUserRls GUC plumbing against a real PostgreSQL (not mocks).
 *
 * withUserRls is in the request path (every ownedCourse/ownedTask/
 * ownedAttachment lookup in ownership.ts), yet had zero direct test hits.
 * The mocked-db route suites cannot observe it: their fake `transaction`
 * has no `execute`, so GUC set/clear behavior was entirely unproven — and
 * their process-wide mock.module("../db") would hijack the getDb()
 * singleton here too, which is why this file targets an explicit database
 * handle via the { db } seam instead of the singleton.
 *
 * DATABASE_URL resolution mirrors the F-1 matrix: CI's fresh PostgreSQL
 * when set, otherwise the local test_verify_all database. (bun runs each
 * test file in isolation, so setting process.env here cannot leak into
 * other suites; this file must never import app.ts.)
 *
 * What this file proves (and what it explicitly does NOT):
 * - claims (sub/role/claims) are set inside the tx and visible to
 *   auth.uid() — the value RLS policies read;
 * - claims are transaction-local (is_local=true): a fresh tx sees nothing,
 *   so user A context cannot leak to user B on pooled-connection reuse;
 * - empty userId throws instead of stamping an anonymous context;
 * - end-to-end: claims + SET LOCAL ROLE authenticated isolates tenants.
 * - NOT proven here: row invisibility on the withUserRls connection alone.
 *   The test DATABASE_URL role bypasses RLS (superuser/service_role), and
 *   withUserRls deliberately sets claims without SET ROLE — invisibility on
 *   such connections is covered by the F-1 matrix (supabase/tests/rls_matrix.sql).
 */
function resolveTestDbUrl(): string {
  if (process.env.TEST_DATABASE_URL) return process.env.TEST_DATABASE_URL;
  const url = process.env.DATABASE_URL;
  if (
    url &&
    !url.includes("supabase.co") &&
    !url.includes("pooler.supabase.com")
  ) {
    if (
      (url.includes("localhost") || url.includes("127.0.0.1")) &&
      !url.includes("sslmode=")
    ) {
      const sep = url.includes("?") ? "&" : "?";
      return `${url}${sep}sslmode=disable`;
    }
    return url;
  }
  return "postgresql://localhost:5432/test_verify_all?sslmode=disable";
}

const db = createDb(resolveTestDbUrl());

describe("withUserRls — transaction-local JWT claims (real DB)", () => {
  const USER_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  const USER_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

  test("sets sub+role claims visible to auth.uid() inside the tx", async () => {
    await withUserRls(
      USER_A,
      async (tx) => {
        const rows = (await tx.execute(
          sql`select current_setting('request.jwt.claim.sub', true) as sub,
                      current_setting('request.jwt.claim.role', true) as role,
                      current_setting('request.jwt.claims', true) as claims,
                      auth.uid() as uid`,
        )) as unknown as {
          sub: string;
          role: string;
          claims: string;
          uid: string;
        }[];
        expect(rows[0].sub).toBe(USER_A);
        expect(rows[0].role).toBe("authenticated");
        expect(JSON.parse(rows[0].claims)).toMatchObject({
          sub: USER_A,
          role: "authenticated",
        });
        expect(rows[0].uid).toBe(USER_A);
      },
      { db },
    );
  });

  test("claims do not leak outside the tx (fresh tx sees nothing)", async () => {
    await withUserRls(USER_A, async () => {}, { db });
    const rows = (await db.transaction(async (tx) =>
      tx.execute(
        sql`select current_setting('request.jwt.claim.sub', true) as sub,
                    current_setting('request.jwt.claim.role', true) as role`,
      ),
    )) as unknown as { sub: string | null; role: string | null }[];
    expect(rows[0].sub ?? "").toBe("");
    expect(rows[0].role ?? "").toBe("");
  });

  test("sequential users on the pool each see their own claims (no cross-talk)", async () => {
    const seen: string[] = [];
    for (const userId of [USER_A, USER_B]) {
      await withUserRls(
        userId,
        async (tx) => {
          const rows = (await tx.execute(
            sql`select auth.uid()::text as uid`,
          )) as unknown as { uid: string }[];
          seen.push(rows[0].uid);
        },
        { db },
      );
    }
    expect(seen).toEqual([USER_A, USER_B]);
  });

  test("empty userId throws instead of stamping an anonymous context", async () => {
    await expect(withUserRls("", async () => {}, { db })).rejects.toThrow(
      "withUserRls requires a user id",
    );
  });

  test("end-to-end: claims + authenticated role isolate tenants", async () => {
    const emailA = "f3-rls-a@example.invalid";
    const emailB = "f3-rls-b@example.invalid";
    try {
      await db.transaction(async (tx) => {
        await tx.execute(
          sql`insert into auth.users (id, email) values (${USER_A}, ${emailA}), (${USER_B}, ${emailB}) on conflict (id) do nothing`,
        );
      });

      const seenAsA = await withUserRls(
        USER_A,
        async (tx) => {
          await tx.execute(sql`SET LOCAL ROLE authenticated`);
          return (await tx.execute(
            sql`select id::text as id from public.profiles order by id`,
          )) as unknown as { id: string }[];
        },
        { db },
      );
      // handle_new_user trigger provisions both profiles; as authenticated
      // A, only A's row is visible.
      expect(seenAsA.map((r) => r.id)).toEqual([USER_A]);
    } finally {
      await db.transaction(async (tx) => {
        await tx.execute(
          sql`delete from auth.users where email in (${emailA}, ${emailB})`,
        );
      });
    }
  });
});
