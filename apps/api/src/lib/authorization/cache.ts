import type { Capability } from "./capabilities";
import type { RoleSlug } from "./roles";

export type CachedAuthzSnapshot = {
  roles: readonly RoleSlug[];
  capabilities: readonly Capability[];
  cachedAt: number;
};

/** Short-lived per-user authz snapshot. Keys are subject user ids only. */
const store = new Map<string, CachedAuthzSnapshot>();

const DEFAULT_TTL_MS = 30_000;

let ttlMs = DEFAULT_TTL_MS;

export function setAuthzCacheTtlMs(ms: number): void {
  ttlMs = Math.max(0, ms);
}

export function getCachedAuthz(
  userId: string,
): CachedAuthzSnapshot | null {
  const hit = store.get(userId);
  if (!hit) return null;
  if (Date.now() - hit.cachedAt > ttlMs) {
    store.delete(userId);
    return null;
  }
  return hit;
}

export function setCachedAuthz(
  userId: string,
  snapshot: Omit<CachedAuthzSnapshot, "cachedAt">,
): void {
  // Never allow empty userId keys (collision / poisoning).
  if (!userId) return;
  store.set(userId, {
    roles: Object.freeze([...snapshot.roles]),
    capabilities: Object.freeze([...snapshot.capabilities]),
    cachedAt: Date.now(),
  });
}

/** Invalidate one user (role assign/revoke) or clear all. */
export function invalidateAuthzCache(userId?: string): void {
  if (userId) {
    store.delete(userId);
    return;
  }
  store.clear();
}

/** Test helper. */
export function resetAuthzCache(): void {
  store.clear();
  ttlMs = DEFAULT_TTL_MS;
}
