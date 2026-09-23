/**
 * Supabase Storage operations with bounded retries (Finding #8).
 *
 * Transport timeouts are enforced by the service client's timeout fetch;
 * retries here cover only THROWN transport-level failures, never returned
 * `{ error }` payloads (a returned error is a definitive provider answer,
 * e.g. duplicate-key from `upsert: false`).
 *
 * Retry safety:
 * - upload: `upsert: false` makes a duplicate object impossible, so a
 *   retried attempt can at worst surface "already exists" faster — never a
 *   second object.
 * - remove: deleting is idempotent.
 * - signed URL minting: read-only.
 */
import type { createServiceClient } from "./supabase";
import { backoffDelayMs, isTransportError, sleep } from "./net";

export const STORAGE_RETRY_ATTEMPTS = 3;

export type ServiceClient = ReturnType<typeof createServiceClient>;
type StorageBucket = ReturnType<ServiceClient["storage"]["from"]>;

async function withStorageRetry<T>(
  operation: () => Promise<T>,
  attempts: number = STORAGE_RETRY_ATTEMPTS,
): Promise<T> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      if (attempt >= attempts || !isTransportError(error)) {
        throw error;
      }
      await sleep(backoffDelayMs(attempt, 500, 5000));
    }
  }
  throw lastError;
}

export function storageUpload(
  client: ServiceClient,
  objectKey: string,
  bytes: ArrayBuffer,
  contentType: string,
  attempts: number = STORAGE_RETRY_ATTEMPTS,
): Promise<Awaited<ReturnType<StorageBucket["upload"]>>> {
  return withStorageRetry(
    () =>
      client.storage.from("attachments").upload(objectKey, bytes, {
        contentType,
        upsert: false,
      }),
    attempts,
  );
}

export function storageRemove(
  client: ServiceClient,
  objectKeys: string[],
  attempts: number = STORAGE_RETRY_ATTEMPTS,
): Promise<Awaited<ReturnType<StorageBucket["remove"]>>> {
  return withStorageRetry(
    () => client.storage.from("attachments").remove(objectKeys),
    attempts,
  );
}

export function storageSignedUrl(
  client: ServiceClient,
  objectKey: string,
  expiresInSeconds: number,
  attempts: number = STORAGE_RETRY_ATTEMPTS,
): Promise<Awaited<ReturnType<StorageBucket["createSignedUrl"]>>> {
  return withStorageRetry(
    () =>
      client.storage.from("attachments").createSignedUrl(objectKey, expiresInSeconds),
    attempts,
  );
}

/**
 * Identify whether a storage provider error is a duplicate/already-exists conflict
 * vs a genuine infrastructure/dependency failure.
 */
export function isStorageDuplicateError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const err = error as Record<string, unknown>;
  const statusCode = err.statusCode ?? err.status;
  if (statusCode === 409 || statusCode === "409") return true;
  if (typeof err.error === "string" && err.error.toLowerCase() === "duplicate") {
    return true;
  }
  if (typeof err.message === "string") {
    const msg = err.message.toLowerCase();
    return (
      msg.includes("already exists") ||
      msg.includes("duplicate") ||
      msg.includes("resource already exists")
    );
  }
  return false;
}

