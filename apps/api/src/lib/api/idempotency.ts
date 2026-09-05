import { and, eq, gt } from "drizzle-orm";
import { createHash } from "node:crypto";
import { idempotencyKeys } from "@deadline-radar/db";

import { getDb } from "../db";
import { ApiError, API_ERROR_CODES } from "./errors";

const IDEMPOTENCY_TTL_MS = 24 * 60 * 60 * 1000;

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
  const now = new Date();
  const [existing] = await db
    .select()
    .from(idempotencyKeys)
    .where(
      and(
        eq(idempotencyKeys.userId, options.userId),
        eq(idempotencyKeys.key, options.key),
        gt(idempotencyKeys.expiresAt, now),
      ),
    )
    .limit(1);

  if (existing) {
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
    // In-flight duplicate — treat as conflict for safety
    throw ApiError.conflict("Idempotent request already in progress");
  }

  await db.insert(idempotencyKeys).values({
    userId: options.userId,
    key: options.key,
    method: options.method,
    path: options.path,
    requestHash: fingerprint,
    expiresAt: new Date(now.getTime() + IDEMPOTENCY_TTL_MS),
  });

  return { replay: null, fingerprint };
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
