/**
 * Idempotency key utilities for frontend mutations.
 *
 * Provides functions to generate, normalize, and derive idempotency keys
 * compliant with the backend contract (8–128 character string).
 */

/**
 * Normalizes an unknown value to a valid idempotency key, or null if invalid.
 */
export function normalizeIdempotencyKey(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  if (trimmed.length < 8 || trimmed.length > 128) return null;
  return trimmed;
}

/**
 * Generates a cryptographically strong UUID v4 idempotency key.
 */
export function generateIdempotencyKey(): string {
  if (
    typeof globalThis !== "undefined" &&
    globalThis.crypto &&
    typeof globalThis.crypto.randomUUID === "function"
  ) {
    return globalThis.crypto.randomUUID();
  }
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

/**
 * Derives a deterministic individual idempotency key for a file within a batch.
 * Format: `${batchKey}-${index}` (length ~38-40 chars, within 8–128 chars).
 */
export function deriveFileIdempotencyKey(
  batchKey: string,
  index: number,
): string {
  return `${batchKey}-${index}`;
}
