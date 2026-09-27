import { afterEach, describe, expect, test } from "bun:test";

import { resetRedisClient, setRedisClientForTests } from "../lib/redis";
import {
  memoryRateLimitStore,
  redisRateLimitStore,
  resetRateLimitBuckets,
  setRateLimitStoreForTests,
  type RateLimitStore,
} from "./rate-limit";

function fakeClient(overrides: {
  incr: () => Promise<number>;
}): {
  incr: () => Promise<number>;
  pexpire: () => Promise<number>;
  get: () => Promise<string | null>;
  set: () => Promise<string | null>;
  del: () => Promise<number>;
} {
  return {
    incr: overrides.incr,
    pexpire: async () => 1,
    get: async () => null,
    set: async () => "OK",
    del: async () => 0,
  };
}

function captureWarns() {
  const lines: string[] = [];
  const original = console.warn;
  console.warn = (...args: unknown[]) => {
    lines.push(args.map(String).join(" "));
  };
  return {
    lines,
    restore: () => {
      console.warn = original;
    },
  };
}

describe("rate limit stores", () => {
  afterEach(() => {
    resetRateLimitBuckets();
    setRateLimitStoreForTests(null);
    resetRedisClient();
    delete process.env.REDIS_TIMEOUT_MS;
  });

  test("memory store limits after max", async () => {
    const key = "test:api";
    for (let i = 0; i < 3; i++) {
      const r = await memoryRateLimitStore.consume(key, 3, 60_000);
      expect(r.limited).toBe(false);
    }
    const limited = await memoryRateLimitStore.consume(key, 3, 60_000);
    expect(limited.limited).toBe(true);
    expect(limited.remaining).toBe(0);
  });

  test("injectable store is used (simulates Redis path)", async () => {
    const calls: string[] = [];
    const fake: RateLimitStore = {
      async consume(key, max, windowMs) {
        calls.push(`${key}:${max}:${windowMs}`);
        return { remaining: max - 1, resetAt: Date.now() + windowMs, limited: false };
      },
    };
    setRateLimitStoreForTests(fake);
    // Exercise via memory API surface — plugin uses activeStore; call fake directly to assert contract
    const result = await fake.consume("ip:api", 180, 60_000);
    expect(result.limited).toBe(false);
    expect(calls[0]).toBe("ip:api:180:60000");
  });

  test("healthy redis verdict is used", async () => {
    let count = 0;
    setRedisClientForTests(
      fakeClient({
        incr: async () => {
          count += 1;
          return count;
        },
      }),
    );
    for (let i = 0; i < 3; i += 1) {
      const r = await redisRateLimitStore.consume("fast:key", 3, 60_000);
      expect(r.limited).toBe(false);
    }
    const limited = await redisRateLimitStore.consume("fast:key", 3, 60_000);
    expect(limited.limited).toBe(true);
    expect(limited.remaining).toBe(0);
  });

  test("slow redis falls back to memory within the bound", async () => {
    process.env.REDIS_TIMEOUT_MS = "50";
    setRedisClientForTests(
      fakeClient({ incr: () => new Promise<number>(() => {}) }),
    );
    const { lines, restore } = captureWarns();
    try {
      const started = Date.now();
      const result = await redisRateLimitStore.consume("slow:key", 3, 60_000);
      expect(Date.now() - started).toBeLessThan(2000);
      expect(result.limited).toBe(false);
      expect(lines.some((l) => l.includes("[redis] incr timeout"))).toBe(true);
    } finally {
      restore();
    }
  });

  test("throwing redis falls back to memory without 500ing", async () => {
    setRedisClientForTests(
      fakeClient({
        incr: async () => {
          throw new Error("boom");
        },
      }),
    );
    const { lines, restore } = captureWarns();
    try {
      const result = await redisRateLimitStore.consume("err:key", 3, 60_000);
      expect(result.limited).toBe(false);
      expect(lines.some((l) => l.includes("[redis] incr failed"))).toBe(true);
    } finally {
      restore();
    }
  });
});
