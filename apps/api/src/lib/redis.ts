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
