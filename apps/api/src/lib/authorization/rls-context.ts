import { sql } from "drizzle-orm";

import { getDb } from "../db";

type Db = ReturnType<typeof getDb>;
type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

/**
 * Run work inside a transaction with Supabase-compatible JWT claim GUCs set
 * so `auth.uid()` RLS policies can apply when DATABASE_URL is a non-BYPASSRLS role.
 *
 * `is_local = true` keeps claims transaction-scoped — required for pooled connections
 * so user A context cannot leak to user B on the same connection.
 */
export async function withUserRls<T>(
  userId: string,
  fn: (tx: Tx) => Promise<T>,
): Promise<T> {
  if (!userId) {
    throw new Error("withUserRls requires a user id");
  }

  return getDb().transaction(async (tx) => {
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
