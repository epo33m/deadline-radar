import { sql, type SQL } from "drizzle-orm";

import { getDb } from "../lib/db";

/**
 * RF-15: deploy-order guard between migrations and newer API code.
 *
 * The sweep-claim state (`20260920040000_sweep_claim_state`) added
 * `notification_status = 'sending'` and `notification_deliveries.claimed_at`.
 * Deploying API code from after that migration against a database that has not
 * run it makes every sweep-claim fail per-row (loud, but never fatal) and the
 * reminder pipeline silently degrades. The migration is safe to run BEFORE the
 * deploy (both adds are additive: `add value if not exists`, `if not exists`),
 * so the right ordering is enforced here instead of in the SQL.
 *
 * Production refuses to boot when either prerequisite is missing, with an
 * operator action that fixes it. Development/test boots are untouched so local
 * work and CI keep booting from a not-yet-fully-migrated local database.
 */

const MIGRATION_HINT =
  'Run "bun run db:migrate" (or "supabase db push") BEFORE deploying this API build.';

export type ReminderSchemaPrereqSnapshot = {
  /** `notification_status` enum contains the value `sending`. */
  hasSendingEnum: boolean;
  /** `notification_deliveries.claimed_at` column exists. */
  hasClaimedAtColumn: boolean;
};

/**
 * Pure: returns a human-readable problem naming every missing prerequisite,
 * or null when the API and database are in the correct order.
 */
export function deriveMissingReminderPrereq(
  snapshot: ReminderSchemaPrereqSnapshot,
): string | null {
  const missing: string[] = [];
  if (!snapshot.hasSendingEnum) {
    missing.push(
      'notification_status enum value "sending" (added by 20260920040000_sweep_claim_state)',
    );
  }
  if (!snapshot.hasClaimedAtColumn) {
    missing.push(
      "notification_deliveries.claimed_at column (added by 20260920040000_sweep_claim_state)",
    );
  }
  if (missing.length === 0) return null;
  return (
    `Database schema is behind this API build (RF-15): missing ${missing.join(
      " and ",
    )}. ${MIGRATION_HINT}`
  );
}

const REMINDER_PREREQ_CHECK = sql`
  select
    exists (
      select 1 from pg_enum pe join pg_type pt on pt.oid = pe.enumtypid
      where pt.typname = 'notification_status' and pe.enumlabel = 'sending'
    ) as has_sending,
    exists (
      select 1 from information_schema.columns
      where table_name = 'notification_deliveries' and column_name = 'claimed_at'
    ) as has_claimed_at
`;

/**
 * Checks the two additive prerequisites from `20260920040000_sweep_claim_state`
 * and throws when either is absent. Only active under NODE_ENV=production. The
 * injected db lets tests drive the thin DB wrapper with a fake.
 */
export async function assertReminderSchemaPrerequisites(
  db: { execute: (query: SQL) => Promise<unknown> } = getDb(),
): Promise<void> {
  if (process.env.NODE_ENV !== "production") return;

  const rows = (await db.execute(REMINDER_PREREQ_CHECK)) as Array<{
    has_sending: boolean;
    has_claimed_at: boolean;
  }>;
  const row = rows[0] ?? { has_sending: false, has_claimed_at: false };

  const problem = deriveMissingReminderPrereq({
    hasSendingEnum: Boolean(row.has_sending),
    hasClaimedAtColumn: Boolean(row.has_claimed_at),
  });
  if (problem) throw new Error(problem);
}