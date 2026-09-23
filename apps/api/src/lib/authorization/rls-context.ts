import { sql } from "drizzle-orm";

import { getDb } from "../db";

type Db = ReturnType<typeof getDb>;
type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

/** Transaction handle for RLS-scoped work. Pass to `*InTx` ownership
 * helpers to fold checks + mutations into ONE transaction per handler
 * (P2-3) instead of paying BEGIN + 3× set_config per ownership check. */
export type UserTx = Tx;

/**
 * Run work inside a transaction with Supabase-compatible JWT claim GUCs set
 * so `auth.uid()` RLS policies can apply when DATABASE_URL is a non-BYPASSRLS role.
 *
 * `is_local = true` keeps claims transaction-scoped — required for pooled connections
 * so user A context cannot leak to user B on the same connection.
 *
 * `opts.db` overrides the getDb() singleton (used by the real-DB test to
 * target the test database without going through the app singleton, which
 * route suites mock process-wide via mock.module).
 */
export async function withUserRls<T>(
  userId: string,
  fn: (tx: Tx) => Promise<T>,
  opts?: { db?: Db },
): Promise<T> {
  if (!userId) {
    throw new Error("withUserRls requires a user id");
  }

  return (opts?.db ?? getDb()).transaction(async (tx) => {
    const claims = JSON.stringify({
      sub: userId,
      role: "authenticated",
    });
    await tx.execute(
      sql`select set_config('request.jwt.claim.sub', ${userId}, true)`,
    );
    await tx.execute(
      sql`select set_config('request.jwt.claim.role', 'authenticated', true)`,
    );
    await tx.execute(
      sql`select set_config('request.jwt.claims', ${claims}, true)`,
    );
    return fn(tx);
  });
}
