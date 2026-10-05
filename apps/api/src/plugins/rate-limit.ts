import { Elysia } from "elysia";

import {
  ApiError,
  toErrorBody,
  normalizeRequestId,
  extractClientRequestId,
  requestIdPlugin,
} from "../lib/api";
import { getRedis, withRedisTimeout } from "../lib/redis";
import { peerAddressOf, resolveClientIp } from "../lib/proxy-trust";

type Bucket = { count: number; resetAt: number };

const memoryBuckets = new Map<string, Bucket>();

export type RateLimitStore = {
  consume(
    key: string,
    max: number,
    windowMs: number,
  ): Promise<{ remaining: number; resetAt: number; limited: boolean }>;
};

function clientKey(request: Request, server: unknown): string {
  return resolveClientIp(request, peerAddressOf(server, request));
}

function limitForPath(pathname: string): { max: number; windowMs: number } {
  if (
    pathname === "/api/v1/auth/login" ||
    pathname === "/api/v1/auth/register" ||
    pathname === "/api/v1/auth/forgot-password" ||
    pathname === "/api/v1/auth/reset-password"
  ) {
    return { max: 20, windowMs: 60_000 };
  }
  if (pathname.startsWith("/api/v1/auth")) {
    return { max: 60, windowMs: 60_000 };
  }
  if (pathname.startsWith("/api/v1/cron")) {
    return { max: 10, windowMs: 60_000 };
  }
  return { max: 180, windowMs: 60_000 };
}

function scopeForPath(pathname: string): string {
  if (pathname.startsWith("/api/v1/auth")) {
    if (
      pathname.startsWith("/api/v1/auth/login") ||
      pathname.startsWith("/api/v1/auth/register") ||
      pathname.startsWith("/api/v1/auth/forgot") ||
      pathname.startsWith("/api/v1/auth/reset")
    ) {
      return "auth-sensitive";
    }
    return "auth";
  }
  if (pathname.startsWith("/api/v1/cron")) return "cron";
  return "api";
}

/** In-memory store (dev / single-node). */
export const memoryRateLimitStore: RateLimitStore = {
  async consume(key, max, windowMs) {
    const now = Date.now();
    let bucket = memoryBuckets.get(key);
    if (!bucket || bucket.resetAt <= now) {
      bucket = { count: 0, resetAt: now + windowMs };
      memoryBuckets.set(key, bucket);
    }
    bucket.count += 1;
    return {
      remaining: Math.max(0, max - bucket.count),
      resetAt: bucket.resetAt,
      limited: bucket.count > max,
    };
  },
};

type RedisRateLimitClient = NonNullable<Awaited<ReturnType<typeof getRedis>>>;

/**
 * Guarantees the Redis counter key will expire: re-applies the window TTL,
 * or removes the key when that fails. Returns false only when neither is
 * possible — the caller must then stop trusting the key and use the memory
 * bucket, or a TTL-less counter would limit the client forever.
 */
async function ensureRateLimitKeyExpiry(
  redis: RedisRateLimitClient,
  redisKey: string,
  windowMs: number,
): Promise<boolean> {
  try {
    const pexpired = await withRedisTimeout(redis.pexpire(redisKey, windowMs));
    // 1 = TTL applied; 0 = key already gone (nothing left to expire).
    if (typeof pexpired === "number") return true;
  } catch (error) {
    console.warn(
      "[redis] pexpire failed",
      error instanceof Error ? error.message : "unknown",
    );
  }
  try {
    const deleted = await withRedisTimeout(redis.del(redisKey));
    if (typeof deleted === "number") return true;
  } catch (error) {
    console.warn(
      "[redis] del failed",
      error instanceof Error ? error.message : "unknown",
    );
  }
  return false;
}

/** Redis-backed store when REDIS_URL is available. */
export const redisRateLimitStore: RateLimitStore = {
  async consume(key, max, windowMs) {
    const redis = await getRedis();
    if (!redis) {
      return memoryRateLimitStore.consume(key, max, windowMs);
    }
    const fallbackToMemory = (reason: string, detail?: string) => {
      if (detail === undefined) {
        console.warn(`[redis] ${reason}, using memory bucket`);
      } else {
        console.warn(`[redis] ${reason}, using memory bucket`, detail);
      }
      return memoryRateLimitStore.consume(key, max, windowMs);
    };
    const now = Date.now();
    const redisKey = `rl:${key}`;
    let count: number | null;
    try {
      count = await withRedisTimeout(redis.incr(redisKey));
    } catch (error) {
      return fallbackToMemory(
        "incr failed",
        error instanceof Error ? error.message : "unknown",
      );
    }
    if (count === null) {
      // Slow Redis (wrong region / incident): fail open to the memory
      // bucket instead of taxing every request. Same posture as Redis
      // being down (Finding #9: process-local, single-replica budget).
      return fallbackToMemory("incr timeout");
    }
    if (count === 1) {
      if (!(await ensureRateLimitKeyExpiry(redis, redisKey, windowMs))) {
        return fallbackToMemory("rate-limit key TTL not guaranteed");
      }
    }
    // Real window end when the server can tell us; a fresh incr fallback
    // would fabricate a full window on every hit near the boundary.
    let resetAt = now + windowMs;
    let ttl: number | null | undefined;
    if (typeof redis.pttl === "function") {
      try {
        ttl = await withRedisTimeout(redis.pttl(redisKey));
      } catch (error) {
        console.warn(
          "[redis] pttl failed",
          error instanceof Error ? error.message : "unknown",
        );
        ttl = null;
      }
    }
    if (typeof ttl === "number" && ttl > 0) {
      resetAt = now + ttl;
    } else if (ttl === -1 || ttl === null) {
      if (!(await ensureRateLimitKeyExpiry(redis, redisKey, windowMs))) {
        return fallbackToMemory("rate-limit key TTL not guaranteed");
      }
    }
    return {
      remaining: Math.max(0, max - count),
      resetAt,
      limited: count > max,
    };
  },
};

let activeStore: RateLimitStore = {
  async consume(key, max, windowMs) {
    const redis = await getRedis();
    if (redis) return redisRateLimitStore.consume(key, max, windowMs);
    return memoryRateLimitStore.consume(key, max, windowMs);
  },
};

/** Test helper — inject a fake store (e.g. Redis path without a real Redis). */
export function setRateLimitStoreForTests(store: RateLimitStore | null): void {
  activeStore =
    store ??
    ({
      async consume(key, max, windowMs) {
        const redis = await getRedis();
        if (redis) return redisRateLimitStore.consume(key, max, windowMs);
        return memoryRateLimitStore.consume(key, max, windowMs);
      },
    } satisfies RateLimitStore);
}

/**
 * Rate limit: Redis when REDIS_URL is set; otherwise in-memory (dev/single-node).
 *
 * Security limitation (Finding #9): the in-memory fallback is PROCESS-LOCAL.
 * It preserves availability and per-process enforcement, but it is NOT a
 * distributed guarantee — N nodes behind a load balancer effectively grant
 * N× the configured budget, and a restart wipes buckets. Do not claim
 * global enforcement unless Redis is configured and reachable.
 */
export const rateLimitPlugin = new Elysia({ name: "rate-limit" })
  .use(requestIdPlugin)
  .onBeforeHandle(
  { as: "global" },
  async ({ request, set, requestId, server }) => {
    const pathname = new URL(request.url).pathname;
    if (pathname === "/health" || pathname.startsWith("/openapi")) return;

    const { max, windowMs } = limitForPath(pathname);
    const key = `${clientKey(request, server)}:${scopeForPath(pathname)}`;
    const { remaining, resetAt, limited } = await activeStore.consume(
      key,
      max,
      windowMs,
    );

    set.headers["X-RateLimit-Limit"] = String(max);
    set.headers["X-RateLimit-Remaining"] = String(remaining);
    set.headers["X-RateLimit-Reset"] = String(Math.ceil(resetAt / 1000));

    if (limited) {
      const rid =
        (typeof requestId === "string" && requestId) ||
        normalizeRequestId(extractClientRequestId(request));
      set.status = 429;
      set.headers["X-Request-Id"] = rid;
      set.headers["Retry-After"] = String(
        Math.max(1, Math.ceil((resetAt - Date.now()) / 1000)),
      );
      return toErrorBody(ApiError.rateLimited(), rid);
    }
  },
);

/** Test helper */
export function resetRateLimitBuckets(): void {
  memoryBuckets.clear();
}
