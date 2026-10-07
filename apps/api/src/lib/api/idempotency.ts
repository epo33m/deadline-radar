import { and, eq, inArray, isNull, lte } from "drizzle-orm";
import { createHash } from "node:crypto";
import { idempotencyKeys } from "@deadline-radar/db";

import { getDb } from "../db";
import { ApiError, API_ERROR_CODES } from "./errors";

export const IDEMPOTENCY_TTL_MS = 24 * 60 * 60 * 1000;
export const DEFAULT_IN_FLIGHT_TIMEOUT_MS = 2 * 60 * 1000; // 2 minutes

export function getInFlightTimeoutMs(): number {
  const envVal = Number(process.env.IDEMPOTENCY_IN_FLIGHT_TIMEOUT_MS);
  return Number.isFinite(envVal) && envVal > 0
    ? envVal
    : DEFAULT_IN_FLIGHT_TIMEOUT_MS;
}

/** Bounded retries for claim races; every iteration observes progress made
 * by a concurrent contender, so exhaustion is defensive only. */
const MAX_CLAIM_ATTEMPTS = 5;

let lastOpportunisticPurge = 0;
const OPPORTUNISTIC_PURGE_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes

export function resetOpportunisticPurgeThrottle(): void {
  lastOpportunisticPurge = 0;
}

export function maybeTriggerOpportunisticPurge(now: number = Date.now()): void {
  if (now - lastOpportunisticPurge < OPPORTUNISTIC_PURGE_INTERVAL_MS) return;
  lastOpportunisticPurge = now;
  purgeExpiredIdempotencyKeys().catch((error) => {
    console.error(
      "[idempotency] opportunistic purge failed:",
      error instanceof Error ? error.message : "unknown error",
    );
  });
}

/**
 * Purge expired idempotency keys in bounded batches.
 * Safe to run from schedulers/cron or opportunistic background workers.
 */
export async function purgeExpiredIdempotencyKeys(options?: {
  now?: Date;
  limit?: number;
}): Promise<number> {
  const now = options?.now ?? new Date();
  const limit = options?.limit ?? 1000;
  const db = getDb();

  const expired = await db
    .select({ id: idempotencyKeys.id })
    .from(idempotencyKeys)
    .where(lte(idempotencyKeys.expiresAt, now))
    .limit(limit);

  if (expired.length === 0) {
    return 0;
  }

  const ids = expired.map((row) => row.id);
  const deleted = await db
    .delete(idempotencyKeys)
    .where(inArray(idempotencyKeys.id, ids))
    .returning({ id: idempotencyKeys.id });

  return deleted.length;
}

export function hashRequestFingerprint(
  method: string,
  path: string,
  body: unknown,
): string {
  const payload = JSON.stringify({
    method,
    path,
    body: body ?? null,
  });
  return createHash("sha256").update(payload).digest("hex");
}

/**
 * Content digest for upload idempotency fingerprints (SHA-256 via
 * node:crypto — no custom crypto). Hashing the bytes (not just
 * filename/size) ensures two different files are never considered the
 * same request.
 */
export function sha256Hex(data: ArrayBuffer | Uint8Array): string {
  const view = data instanceof Uint8Array ? data : new Uint8Array(data);
  return createHash("sha256").update(view).digest("hex");
}

export function readIdempotencyKey(request: Request): string | null {
  const raw = request.headers.get("idempotency-key")?.trim();
  if (!raw) return null;
  if (raw.length < 8 || raw.length > 128) {
    throw ApiError.validation("Invalid Idempotency-Key", [
      {
        field: "Idempotency-Key",
        message: "Idempotency-Key must be 8–128 characters",
      },
    ]);
  }
  return raw;
}

export type IdempotencyReplay = {
  statusCode: number;
  body: unknown;
};

/**
 * Begin an idempotent operation. Returns a replay if a prior matching response exists.
 * Throws CONFLICT if the same key was used with a different fingerprint.
 *
 * Race safety: the claim is an atomic `INSERT … ON CONFLICT DO NOTHING`
 * guarded by the `unique (user_id, key)` constraint — exactly one concurrent
 * contender inserts the row and proceeds to the protected side effect; every
 * loser re-reads the winner's row and follows the single-row contract below
 * (replay / fingerprint-mismatch 409 / in-flight 409 / stale reclaim) without
 * ever reaching the side effect. Expired rows and stale in-flight rows are
 * reclaimed with atomic conditional DELETEs so a lapsed TTL or crashed worker
 * never permanently pins a key.
 */
export async function beginIdempotent(options: {
  userId: string;
  key: string;
  method: string;
  path: string;
  body: unknown;
}): Promise<{ replay: IdempotencyReplay | null; fingerprint: string }> {
  const fingerprint = hashRequestFingerprint(
    options.method,
    options.path,
    options.body,
  );
  const db = getDb();

  for (let attempt = 0; attempt < MAX_CLAIM_ATTEMPTS; attempt += 1) {
    const now = new Date();
    maybeTriggerOpportunisticPurge(now.getTime());

    const [existing] = await db
      .select()
      .from(idempotencyKeys)
      .where(
        and(
          eq(idempotencyKeys.userId, options.userId),
          eq(idempotencyKeys.key, options.key),
        ),
      )
      .limit(1);

    if (!existing) {
      const inserted = await db
        .insert(idempotencyKeys)
        .values({
          userId: options.userId,
          key: options.key,
          method: options.method,
          path: options.path,
          requestHash: fingerprint,
          expiresAt: new Date(now.getTime() + IDEMPOTENCY_TTL_MS),
        })
        .onConflictDoNothing({
          target: [idempotencyKeys.userId, idempotencyKeys.key],
        })
        .returning();
      if (inserted.length > 0) {
        return { replay: null, fingerprint };
      }
      // Lost the insert race: re-read the winner's row below.
      continue;
    }

    if (existing.expiresAt.getTime() <= now.getTime()) {
      // Lapsed TTL: reclaim atomically; exactly one contender deletes.
      const reclaimed = await db
        .delete(idempotencyKeys)
        .where(
          and(
            eq(idempotencyKeys.userId, options.userId),
            eq(idempotencyKeys.key, options.key),
            lte(idempotencyKeys.expiresAt, now),
          ),
        )
        .returning({ id: idempotencyKeys.id });
      void reclaimed;
      // Either we reclaimed (retry the insert) or a contender did first
      // (re-read whatever row is current now).
      continue;
    }

    if (existing.requestHash !== fingerprint) {
      throw new ApiError({
        status: 409,
        code: API_ERROR_CODES.IDEMPOTENCY_CONFLICT,
        message: "Idempotency-Key reused with a different request",
      });
    }
    if (existing.responseStatus != null && existing.responseBody != null) {
      return {
        replay: {
          statusCode: existing.responseStatus,
          body: existing.responseBody,
        },
        fingerprint,
      };
    }

    const inFlightTimeoutMs = getInFlightTimeoutMs();
    const isStaleInFlight =
      now.getTime() - existing.createdAt.getTime() > inFlightTimeoutMs;

    if (isStaleInFlight) {
      // Prior attempt timed out or crashed without completing.
      // Reclaim atomically: exactly one contender deletes the stale in-flight row.
      const staleCutoff = new Date(now.getTime() - inFlightTimeoutMs);
      const reclaimed = await db
        .delete(idempotencyKeys)
        .where(
          and(
            eq(idempotencyKeys.userId, options.userId),
            eq(idempotencyKeys.key, options.key),
            isNull(idempotencyKeys.responseStatus),
            lte(idempotencyKeys.createdAt, staleCutoff),
          ),
        )
        .returning({ id: idempotencyKeys.id });
      void reclaimed;
      // Either we reclaimed (retry the insert) or a contender did first.
      continue;
    }

    // Active in-flight duplicate — treat as conflict for safety
    throw ApiError.conflict("Idempotent request already in progress");
  }

  // Defensive: unreachable unless contenders keep reclaiming the same row.
  throw ApiError.conflict("Idempotent request already in progress");
}

/**
 * #136: free our own uncompleted claim after a definitive client error (4xx)
 * so the same key can be retried immediately — with a corrected body — instead
 * of being answered 409 until the 2-minute stale reclaim. Scoped to the
 * caller's key AND `response_status IS NULL`, so a completed row (replay) is
 * never touched. Never throws: a failed release only logs; the stale reclaim
 * remains the backstop.
 */
export async function releaseIdempotent(options: {
  userId: string;
  key: string;
}): Promise<void> {
  try {
    await getDb()
      .delete(idempotencyKeys)
      .where(
        and(
          eq(idempotencyKeys.userId, options.userId),
          eq(idempotencyKeys.key, options.key),
          isNull(idempotencyKeys.responseStatus),
        ),
      );
  } catch (error) {
    console.error(
      "[idempotency] release failed",
      `userId=${options.userId} key=${options.key}`,
      error instanceof Error ? error.message : "unknown error",
    );
  }
}

/**
 * Release the claim when the request failed with a definitive client error
 * (4xx): the protected side effect did not commit, so the key must be free.
 * 5xx/transport failures keep the claim — a lost response must still replay.
 */
export async function releaseIdempotentOnClientError(
  error: unknown,
  options: { userId: string; key: string | null },
): Promise<void> {
  if (!options.key) return;
  if (!(error instanceof ApiError)) return;
  if (error.status < 400 || error.status >= 500) return;
  await releaseIdempotent({ userId: options.userId, key: options.key });
}

/** I-02: bounded attempts for post-commit completion. The business row is
 * already committed when this runs, so a transient write failure must be
 * retried here rather than surfaced — a persistently failing completion must
 * never turn an already-applied side effect into a 500. */
const MAX_COMPLETE_ATTEMPTS = 3;
const COMPLETE_RETRY_BACKOFF_MS = 100;

/**
 * Record the completed response for an idempotency key. Never throws for
 * write failures: retries bounded, then returns false so the caller serves
 * the already-built success response (the side effect is committed).
 * Failures are logged with key + user scope for diagnosis. Callers must
 * still return their success response regardless of the boolean.
 */
export async function completeIdempotent(options: {
  userId: string;
  key: string;
  statusCode: number;
  body: unknown;
}): Promise<boolean> {
  for (let attempt = 1; attempt <= MAX_COMPLETE_ATTEMPTS; attempt += 1) {
    try {
      await getDb()
        .update(idempotencyKeys)
        .set({
          responseStatus: options.statusCode,
          responseBody: options.body as Record<string, unknown>,
        })
        .where(
          and(
            eq(idempotencyKeys.userId, options.userId),
            eq(idempotencyKeys.key, options.key),
          ),
        );
      return true;
    } catch (error) {
      console.error(
        `[idempotency] complete failed (attempt ${attempt}/${MAX_COMPLETE_ATTEMPTS})`,
        `userId=${options.userId} key=${options.key}`,
        error instanceof Error ? error.message : "unknown error",
      );
      if (attempt >= MAX_COMPLETE_ATTEMPTS) return false;
      await new Promise((resolve) =>
        setTimeout(resolve, COMPLETE_RETRY_BACKOFF_MS * attempt),
      );
    }
  }
  return false;
}
