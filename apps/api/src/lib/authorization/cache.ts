import { getRedis, withRedisTimeout } from "../redis";
import type { Capability } from "./capabilities";
import type { RoleSlug } from "./roles";

export type CachedAuthzSnapshot = {
  roles: readonly RoleSlug[];
  capabilities: readonly Capability[];
  cachedAt: number;
  /**
   * Authz generation observed when this snapshot was written. A read only
   * serves the snapshot while this still matches the current generation, so a
   * mutation on ANY replica retires it without waiting out the TTL.
   */
  generation: string;
};

/** Short-lived per-user authz snapshot. Keys are subject user ids only. */
const store = new Map<string, CachedAuthzSnapshot>();

const DEFAULT_TTL_MS = 30_000;

let ttlMs = DEFAULT_TTL_MS;

export function setAuthzCacheTtlMs(ms: number): void {
  ttlMs = Math.max(0, ms);
}

/**
 * #161: bumped on every invalidation so a read that started BEFORE the
 * invalidation cannot re-cache the entry the invalidation removed.
 *
 * The defect this fixes was ordering, not staleness: `invalidateAuthzCache`
 * performed an unconditional delete while the read path performed an
 * unconditional write after awaiting the database. A read already inside
 * `loadAuthorizationContext` when a revoke committed held a pre-revoke
 * snapshot and reinstated it after the delete, restarting the TTL — so the
 * capability that was revoked (role.assign) was restored with it and the
 * revoked principal could re-grant itself admin durably. Invalidate-then-
 * populate is only correct when no read is concurrently in flight, which is a
 * property a revocation cannot accept.
 */
const generations = new Map<string, number>();

/** Long enough to outlive any snapshot TTL; refreshed on every bump. */
const SHARED_GENERATION_TTL_MS = 24 * 60 * 60_000;

/**
 * Redis-backed generation counter shared by every API replica.
 *
 * The snapshot deliberately stays in-process: putting it in Redis would put a
 * network round trip on the hit path of every authorization decision. Only the
 * counter is shared, so a revoke on one replica retires the stale snapshot on
 * every other replica via the freshness check instead.
 *
 * Redis is optional (`getRedis()` returns null when unconfigured, exactly as
 * the rate limiter and auth-abuse throttle already assume). When it is absent
 * or unreachable this degrades to the in-process counter, which is still
 * race-correct within one replica — the documented single-replica deployment
 * (docs/DEPLOY-PROD.md) — and merely not cross-replica.
 */
const SHARED_GENERATION_PREFIX = "authz:gen:";

let redisOverride: Awaited<ReturnType<typeof getRedis>> | undefined;

/** Test helper — injects a fake client (mirrors auth-abuse redisOverride). */
export function setAuthzRedisForTests(
  redis: Awaited<ReturnType<typeof getRedis>> | undefined,
): void {
  redisOverride = redis;
}

async function resolveRedis() {
  if (redisOverride !== undefined) return redisOverride;
  return getRedis();
}

type AuthzRedisClient = NonNullable<Awaited<ReturnType<typeof getRedis>>>;

/** In-process generation for this user; 0 when never invalidated. */
export function authzCacheGeneration(userId: string): number {
  return generations.get(userId) ?? 0;
}

/**
 * Best-effort read of the shared counter. `null` means "unavailable" (no Redis
 * configured, timed out, or errored) and the caller must fall back to the
 * in-process generation rather than treating it as 0.
 */
async function sharedGeneration(userId: string): Promise<number | null> {
  const redis = await resolveRedis();
  if (!redis) return null;
  try {
    const raw = await withRedisTimeout(
      (redis as AuthzRedisClient).get(`${SHARED_GENERATION_PREFIX}${userId}`),
    );
    // withRedisTimeout returns null on timeout, and a missing key is also null.
    // An explicit `undefined` from a fake client distinguishes the two.
    if (raw === null || raw === undefined) return null;
    const value = Number(raw);
    return Number.isFinite(value) ? value : null;
  } catch (error) {
    console.warn(
      "[authz] shared generation read failed, using in-process generation",
      error instanceof Error ? error.message : "unknown",
    );
    return null;
  }
}

/** Best-effort bump of the shared counter. */
async function bumpSharedGeneration(userId: string): Promise<void> {
  const redis = await resolveRedis();
  if (!redis) return;
  try {
    const key = `${SHARED_GENERATION_PREFIX}${userId}`;
    await withRedisTimeout(
      (async () => {
        await (redis as AuthzRedisClient).incr(key);
        await (redis as AuthzRedisClient).pexpire(key, SHARED_GENERATION_TTL_MS);
      })(),
    );
  } catch (error) {
    console.warn(
      "[authz] shared generation bump failed; other replicas keep their entry",
      error instanceof Error ? error.message : "unknown",
    );
  }
}

/**
 * Composite token of the CURRENT invalidation state.
 *
 * Compared as an opaque string so a caller can capture it once at the start of
 * a database read and re-check it before writing the result. The shared half
 * is empty when Redis is unavailable, which degrades that comparison to the
 * in-process counter instead of failing.
 */
export async function authzGenerationToken(userId: string): Promise<string> {
  const shared = await sharedGeneration(userId);
  return `${authzCacheGeneration(userId)}:${shared === null ? "" : shared}`;
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

/**
 * Read path lookup: TTL plus a generation check.
 *
 * The generation check is what makes an invalidation on another replica visible
 * here. A snapshot written before the shared counter moved is retired on sight
 * rather than served for the remainder of its TTL — which, without this, was a
 * full 30 seconds of revoked capability on every replica but the one that
 * served the mutation.
 */
export async function getFreshAuthz(
  userId: string,
  generation: string,
): Promise<CachedAuthzSnapshot | null> {
  const hit = getCachedAuthz(userId);
  if (!hit) return null;
  if (hit.generation !== generation) {
    store.delete(userId);
    return null;
  }
  return hit;
}

export function setCachedAuthz(
  userId: string,
  snapshot: Omit<CachedAuthzSnapshot, "cachedAt" | "generation">,
  generation: string,
): void {
  // Never allow empty userId keys (collision / poisoning).
  if (!userId) return;
  store.set(userId, {
    roles: Object.freeze([...snapshot.roles]),
    capabilities: Object.freeze([...snapshot.capabilities]),
    cachedAt: Date.now(),
    generation,
  });
}

/**
 * Invalidate one user (role assign/revoke) or clear all.
 *
 * The local generation is bumped SYNCHRONOUSLY, before any await, so a caller
 * that does not await (tests, and any future fire-and-forget use) still gets
 * the race-safe ordering. The shared bump follows and is best-effort.
 */
export function invalidateAuthzCache(userId?: string): void {
  if (userId) {
    store.delete(userId);
    generations.set(userId, authzCacheGeneration(userId) + 1);
    void bumpSharedGeneration(userId);
    return;
  }
  store.clear();
  generations.clear();
  void clearSharedGenerations();
}

/** Full invalidation also retires every replica's view. */
async function clearSharedGenerations(): Promise<void> {
  const redis = await resolveRedis();
  if (!redis) return;
  try {
    // No SCAN surface on the shared RedisLike contract, and a full invalidation
    // is rare (tests, and any operational reset). Bumping a global epoch key
    // retires every snapshot on every replica without enumerating keys.
    await withRedisTimeout((redis as AuthzRedisClient).incr("authz:gen:@all"));
  } catch (error) {
    console.warn(
      "[authz] shared generation clear failed",
      error instanceof Error ? error.message : "unknown",
    );
  }
}

/**
 * Test helper — write a snapshot as a completed read would, stamped with the
 * CURRENT generation token. Tests that prime the cache this way exercise the
 * same freshness contract the real read path uses, instead of hand-writing a
 * token that could drift from what the code produces.
 */
export async function primeCachedAuthz(
  userId: string,
  snapshot: { roles: readonly RoleSlug[]; capabilities: readonly Capability[] },
): Promise<void> {
  setCachedAuthz(userId, snapshot, await authzGenerationToken(userId));
}

/** Test helper. */
export function resetAuthzCache(): void {
  store.clear();
  // Generations must reset with the store: a leftover bump would make the next
  // test's read see a token nothing in that test produced.
  generations.clear();
  redisOverride = undefined;
  ttlMs = DEFAULT_TTL_MS;
}