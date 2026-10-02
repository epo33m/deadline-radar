import { env } from "../env";

type RedisLike = {
  incr(key: string): Promise<number>;
  pexpire(key: string, ms: number): Promise<number>;
  pttl?: (key: string) => Promise<number>;
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

function restConfig(): { url: string; token: string } | null {
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  return url && token ? { url, token } : null;
}

/**
 * Optional Redis, two transports (perf plan, Fase D):
 * 1. Upstash REST (`UPSTASH_REDIS_REST_URL` + `UPSTASH_REDIS_REST_TOKEN`) —
 *    HTTP, no connection management, preferred when present. REST takes
 *    precedence over `REDIS_URL` so rate-limit accounting never splits
 *    across two stores.
 * 2. ioredis TCP (`REDIS_URL`) — legacy path, kept for environments that
 *    already run it.
 * Returns null when neither is set — callers must fall back to memory.
 */
export async function getRedis(): Promise<RedisLike | null> {
  if (redisClient !== undefined) return redisClient;
  const rest = restConfig();
  if (rest) {
    try {
      // Dynamic import keeps the transport optional for local/dev.
      const { Redis } = await import("@upstash/redis");
      redisClient = new Redis(rest) as unknown as RedisLike;
      return redisClient;
    } catch (err) {
      console.warn(
        "[redis] REST unavailable, falling back to in-memory stores",
        err,
      );
      redisClient = null;
      return null;
    }
  }
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
    // Issue #89, same class (found while investigating, not in the issue):
    // without an 'error' listener, an EventEmitter 'error' from a Redis
    // drop mid-run throws straight into uncaughtException and kills the
    // process. Contain it here and drop the cached client so the next call
    // retries the connection or falls back to the in-memory stores.
    client.on("error", (err) => {
      console.error(
        "[redis] connection error — dropping cached client, callers fall back to in-memory stores",
        err instanceof Error ? err.message : err,
      );
      redisClient = undefined;
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
