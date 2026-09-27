/**
 * Per-user bootstrap response cache (perf plan, Fase F).
 *
 * Shape mirrors `authorization/cache.ts` on purpose: in-process Map,
 * per-userId key, short TTL. Same single-replica constraint (see
 * docs/PROD_ENV_CHECKLIST.md §11) — correctness never depends on it
 * because entries expire and every mutation evicts (see the invalidation
 * hook below; over-eviction only costs a refetch, never stale data
 * beyond the TTL).
 */

type Entry = {
  response: unknown;
  expiresAt: number;
};

const entries = new Map<string, Entry>();

/** Milliseconds; `BOOTSTRAP_CACHE_TTL_MS`, 0 disables. Default 30s. */
export function bootstrapCacheTtlMs(): number {
  const raw = Number(process.env.BOOTSTRAP_CACHE_TTL_MS ?? "");
  if (process.env.BOOTSTRAP_CACHE_TTL_MS !== undefined) {
    return Number.isFinite(raw) && raw > 0 ? raw : 0;
  }
  return 30_000;
}

export function getCachedBootstrap(userId: string): unknown | null {
  const entry = entries.get(userId);
  if (!entry) return null;
  if (entry.expiresAt <= Date.now()) {
    entries.delete(userId);
    return null;
  }
  return entry.response;
}

export function setCachedBootstrap(userId: string, response: unknown): void {
  if (bootstrapCacheTtlMs() <= 0) return;
  entries.set(userId, {
    response,
    expiresAt: Date.now() + bootstrapCacheTtlMs(),
  });
}

export function invalidateBootstrapCache(userId: string): void {
  entries.delete(userId);
}

/** Test helper */
export function resetBootstrapCache(): void {
  entries.clear();
}

const MUTATING_METHODS = new Set(["POST", "PATCH", "PUT", "DELETE"]);

/**
 * Returns true when this request may have changed bootstrap-visible data.
 * Conservative by design: any successful authenticated mutation evicts,
 * including ones whose payload bootstrap does not carry (notification
 * reads, role changes) — a wasted refetch, never a stale read.
 */
export function isBootstrapInvalidating(
  method: string,
  status: number | undefined,
  userId: string | null | undefined,
): boolean {
  return (
    MUTATING_METHODS.has(method) &&
    typeof status === "number" &&
    status >= 200 &&
    status < 300 &&
    typeof userId === "string" &&
    userId.length > 0
  );
}
