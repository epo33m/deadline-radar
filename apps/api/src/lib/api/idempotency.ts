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

export async function completeIdempotent(options: {
  userId: string;
  key: string;
  statusCode: number;
  body: unknown;
}): Promise<void> {
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
}
