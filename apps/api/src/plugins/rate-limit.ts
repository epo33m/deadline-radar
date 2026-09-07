import { Elysia } from "elysia";

import {
  ApiError,
  toErrorBody,
  normalizeRequestId,
  extractClientRequestId,
  requestIdPlugin,
} from "../lib/api";
import { env } from "../env";
import { getRedis } from "../lib/redis";

type Bucket = { count: number; resetAt: number };

const memoryBuckets = new Map<string, Bucket>();

export type RateLimitStore = {
  consume(
    key: string,
    max: number,
    windowMs: number,
  ): Promise<{ remaining: number; resetAt: number; limited: boolean }>;
};

function clientKey(request: Request): string {
  if (env.trustProxy()) {
    const forwarded = request.headers.get("x-forwarded-for");
    if (forwarded) return forwarded.split(",")[0]?.trim() || "unknown";
    return request.headers.get("x-real-ip") ?? "local";
  }
  return "local";
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

/** Redis-backed store when REDIS_URL is available. */
export const redisRateLimitStore: RateLimitStore = {
  async consume(key, max, windowMs) {
    const redis = await getRedis();
    if (!redis) {
      return memoryRateLimitStore.consume(key, max, windowMs);
    }
    const now = Date.now();
    const redisKey = `rl:${key}`;
    const count = await redis.incr(redisKey);
    if (count === 1) {
      await redis.pexpire(redisKey, windowMs);
    }
    return {
      remaining: Math.max(0, max - count),
      resetAt: now + windowMs,
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
 */
export const rateLimitPlugin = new Elysia({ name: "rate-limit" })
  .use(requestIdPlugin)
  .onBeforeHandle(
  { as: "global" },
  async ({ request, set, requestId }) => {
    const pathname = new URL(request.url).pathname;
    if (pathname === "/health" || pathname.startsWith("/openapi")) return;

    const { max, windowMs } = limitForPath(pathname);
    const key = `${clientKey(request)}:${scopeForPath(pathname)}`;
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
      return toErrorBody(ApiError.rateLimited(), rid);
    }
  },
);

/** Test helper */
export function resetRateLimitBuckets(): void {
  memoryBuckets.clear();
}
