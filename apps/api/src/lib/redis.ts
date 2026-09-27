import { env } from "../env";

type RedisLike = {
  incr(key: string): Promise<number>;
  pexpire(key: string, ms: number): Promise<number>;
  get(key: string): Promise<string | null>;
  set(key: string, value: string, opts?: { px?: number; nx?: boolean }): Promise<string | null>;
  del(key: string): Promise<number>;
};

let redisClient: RedisLike | null | undefined;

/**
 * Bound for a single Redis round trip (perf plan, Fase D).
 *
 * The rate limiter runs on EVERY /api/* request, so a slow Redis region
 * becomes a per-request tax (measured: ~180ms INCR from us-east). Healthy
 * in-region Redis answers in single-digit ms; anything beyond the bound is
 * treated like Redis being down (memory fallback + warn) instead of
 * stalling the request. Overridable via `REDIS_TIMEOUT_MS`.
 */
export function redisTimeoutMs(): number {
  const raw = Number(process.env.REDIS_TIMEOUT_MS ?? "");
  return Number.isFinite(raw) && raw > 0 ? raw : 250;
}

/** Race a Redis op against the bound; `null` on timeout (caller falls back). */
export async function withRedisTimeout<T>(
  promise: Promise<T>,
  ms: number = redisTimeoutMs(),
): Promise<T | null> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const timeout = new Promise<null>((resolve) => {
      timer = setTimeout(() => resolve(null), ms);
    });
    return await Promise.race([promise, timeout]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

/** Test helper — inject a fake client (mirrors auth-abuse redisOverride). */
export function setRedisClientForTests(
  client: RedisLike | null | undefined,
): void {
  redisClient = client;
}

/**
 * Optional Redis (ioredis-compatible via Bun redis or dynamic import).
 * Returns null when REDIS_URL is unset — callers must fall back to memory.
 */
export async function getRedis(): Promise<RedisLike | null> {
  if (redisClient !== undefined) return redisClient;
  const url = env.redisUrl();
  if (!url) {
    redisClient = null;
    return null;
  }
  try {
    // Dynamic import keeps Redis optional for local/dev without the package wired hard.
    const { Redis } = await import("ioredis");
    const client = new Redis(url, {
      maxRetriesPerRequest: 1,
      enableReadyCheck: true,
      lazyConnect: true,
    });
    await client.connect();
    redisClient = client as unknown as RedisLike;
    return redisClient;
  } catch (err) {
    console.warn("[redis] unavailable, falling back to in-memory stores", err);
    redisClient = null;
    return null;
  }
}

/** Test helper */
export function resetRedisClient(): void {
  redisClient = undefined;
}
