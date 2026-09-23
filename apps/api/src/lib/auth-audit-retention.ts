import { inArray, lt } from "drizzle-orm";
import { authAuditEvents } from "@deadline-radar/db";

import { getDb } from "./db";

/**
 * Auth audit retention (Finding L-11).
 *
 * No retention period is hard-coded on purpose: the repo has no product/legal
 * requirement that establishes how long `auth_audit_events` (IP, User-Agent,
 * user reference, event metadata) may be kept. Choosing a period unilaterally
 * would be a policy decision, so the policy stays external:
 *
 *   AUTH_AUDIT_RETENTION_DAYS=<days>   (product/legal/security must set it)
 *
 * While the variable is unset the trail remains append-only (no purge) —
 * exactly the pre-existing behavior. Once set, the cron entry
 * /api/v1/cron/evaluate-reminders purges in bounded batches using the
 * existing idx_auth_audit_events_created_at index (btree, created_at DESC —
 * used by the `created_at < cutoff` predicate).
 *
 * Safe to run repeatedly and from overlapping scheduler executions: the
 * delete targets a concrete id list, so concurrent/duplicate runs simply
 * delete the rows that still exist and report only those actually removed.
 */
export const AUTH_AUDIT_RETENTION_ENV = "AUTH_AUDIT_RETENTION_DAYS";
export const AUTH_AUDIT_PURGE_BATCH_SIZE = 500;

export function getAuthAuditRetentionDays(): number | null {
  const raw = process.env[AUTH_AUDIT_RETENTION_ENV];
  if (!raw || raw.trim() === "") return null;
  const days = Number(raw);
  if (!Number.isFinite(days) || days <= 0) return null;
  return days;
}

export function authAuditRetentionCutoff(now: Date = new Date()): Date | null {
  const days = getAuthAuditRetentionDays();
  if (days === null) return null;
  return new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
}

/**
 * Delete expired auth audit events in bounded batches.
 * Returns the number of rows deleted in this call.
 *
 * No retention configured -> returns 0 and touches nothing (deferred policy).
 */
export async function purgeExpiredAuthAuditEvents(options?: {
  now?: Date;
  limit?: number;
}): Promise<number> {
  const now = options?.now ?? new Date();
  const limit = options?.limit ?? AUTH_AUDIT_PURGE_BATCH_SIZE;
  const cutoff = authAuditRetentionCutoff(now);
  if (cutoff === null) {
    return 0;
  }

  const db = getDb();

  const expired = await db
    .select({ id: authAuditEvents.id })
    .from(authAuditEvents)
    .where(lt(authAuditEvents.createdAt, cutoff))
    .limit(limit);

  if (expired.length === 0) {
    return 0;
  }

  const ids = expired.map((row) => row.id);
  const deleted = await db
    .delete(authAuditEvents)
    .where(inArray(authAuditEvents.id, ids))
    .returning({ id: authAuditEvents.id });

  return deleted.length;
}