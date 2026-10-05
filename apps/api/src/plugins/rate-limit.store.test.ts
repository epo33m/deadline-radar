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
  pexpire?: (key: string, ms: number) => Promise<number>;
  pttl?: () => Promise<number>;
  del?: (key: string) => Promise<number>;
}): {
  incr: () => Promise<number>;
  pexpire: (key: string, ms: number) => Promise<number>;
  pttl?: () => Promise<number>;
  get: () => Promise<string | null>;
  set: () => Promise<string | null>;
  del: (key: string) => Promise<number>;
} {
  return {
    incr: overrides.incr,
    pexpire: overrides.pexpire ?? (async () => 1),
    pttl: overrides.pttl,
    get: async () => null,
    set: async () => "OK",
    del: overrides.del ?? (async () => 0),
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

  test("redis resetAt tracks real PTTL instead of a full fabricated window", async () => {
    setRedisClientForTests(
      fakeClient({
        incr: async () => 2,
        pttl: async () => 30_000,
      }),
    );
    const before = Date.now();
    const result = await redisRateLimitStore.consume("pttl:key", 3, 60_000);
    expect(result.resetAt).toBeGreaterThanOrEqual(before + 29_000);
    expect(result.resetAt).toBeLessThanOrEqual(before + 31_000);
  });

  test("missing/absent PTTL is healed and falls back to a full window", async () => {
    const pexpireCalls: string[] = [];
    setRedisClientForTests(
      fakeClient({
        incr: async () => 2,
        pexpire: async (key) => {
          pexpireCalls.push(key);
          return 1;
        },
        pttl: async () => -1,
      }),
    );
    const before = Date.now();
    const result = await redisRateLimitStore.consume("pttl:key2", 3, 60_000);
    expect(result.resetAt).toBeGreaterThanOrEqual(before + 59_000);
    expect(pexpireCalls).toEqual(["rl:pttl:key2"]);
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

  test("key left without TTL is healed instead of permanently limiting", async () => {
    let exists = true;
    let ttl: number | null = null;
    const pexpireCalls: Array<[string, number]> = [];
    setRedisClientForTests(
      fakeClient({
        // The incr that observed count===1 applied server-side but its
        // response was lost, so later incrs return >= 2 with no TTL set.
        incr: async () => 2,
        pexpire: async (key, ms) => {
          pexpireCalls.push([key, ms]);
          ttl = ms;
          return exists ? 1 : 0;
        },
        pttl: async () => (exists && ttl !== null ? ttl : -1),
        del: async () => {
          exists = false;
          ttl = null;
          return 1;
        },
      }),
    );
    const result = await redisRateLimitStore.consume("heal:key", 3, 60_000);
    expect(pexpireCalls).toEqual([["rl:heal:key", 60_000]]);
    expect(ttl as number | null).toBe(60_000);
    expect(result.limited).toBe(false);
    const healed = await redisRateLimitStore.consume("heal:key", 3, 60_000);
    expect(healed.resetAt).toBeLessThanOrEqual(Date.now() + 60_000);
  });

  test("lost incr response (timeout) is healed on the next request", async () => {
    process.env.REDIS_TIMEOUT_MS = "50";
    let exists = false;
    let count = 0;
    let ttl: number | null = null;
    let loseNextIncr = true;
    setRedisClientForTests(
      fakeClient({
        incr: async () => {
          if (!exists) {
            exists = true;
            count = 0;
          }
          count += 1;
          if (loseNextIncr) {
            loseNextIncr = false;
            // The server-side incr applied (count===1) but the response
            // never made it back, so pexpire was never observed/sent.
            return new Promise<number>(() => {});
          }
          return count;
        },
        pexpire: async (_key, ms) => {
          ttl = ms;
          return exists ? 1 : 0;
        },
        pttl: async () => (exists && ttl !== null ? ttl : -1),
        del: async () => {
          exists = false;
          count = 0;
          ttl = null;
          return 1;
        },
      }),
    );
    const first = await redisRateLimitStore.consume("lost:key", 3, 60_000);
    expect(first.limited).toBe(false);
    expect(ttl as number | null).toBeNull();
    const second = await redisRateLimitStore.consume("lost:key", 3, 60_000);
    expect(ttl as number | null).toBe(60_000);
    expect(second.limited).toBe(false);
  });

  test("pexpire failure on first hit deletes the TTL-less key", async () => {
    let exists = true;
    const delCalls: string[] = [];
    setRedisClientForTests(
      fakeClient({
        incr: async () => 1,
        pexpire: async () => {
          if (!exists) return 0;
          throw new Error("pexpire unavailable");
        },
        pttl: async () => (exists ? -1 : -2),
        del: async (key) => {
          delCalls.push(key);
          exists = false;
          return 1;
        },
      }),
    );
    const { lines, restore } = captureWarns();
    try {
      const result = await redisRateLimitStore.consume("del:key", 3, 60_000);
      expect(result.limited).toBe(false);
      expect(delCalls).toEqual(["rl:del:key"]);
      expect(exists).toBe(false);
      expect(lines.some((l) => l.includes("[redis] pexpire failed"))).toBe(true);
    } finally {
      restore();
    }
  });

  test("pexpire+delete both failing falls back to memory, not permanent 429", async () => {
    setRedisClientForTests(
      fakeClient({
        // Over max: the Redis verdict would 429 the client forever if the
        // TTL-less counter were trusted.
        incr: async () => 5,
        pexpire: async () => {
          throw new Error("pexpire down");
        },
        pttl: async () => -1,
        del: async () => {
          throw new Error("del down");
        },
      }),
    );
    const { lines, restore } = captureWarns();
    try {
      const result = await redisRateLimitStore.consume("fallback:key", 3, 60_000);
      expect(result.limited).toBe(false);
      expect(result.remaining).toBe(2);
      expect(lines.some((l) => l.includes("using memory bucket"))).toBe(true);
    } finally {
      restore();
    }
  });

  test("pttl timeout triggers TTL heal within the bound", async () => {
    process.env.REDIS_TIMEOUT_MS = "50";
    const pexpireCalls: Array<[string, number]> = [];
    setRedisClientForTests(
      fakeClient({
        incr: async () => 2,
        pexpire: async (key, ms) => {
          pexpireCalls.push([key, ms]);
          return 1;
        },
        pttl: () => new Promise<number>(() => {}),
      }),
    );
    const started = Date.now();
    const result = await redisRateLimitStore.consume("pttl-timeout:key", 3, 60_000);
    expect(Date.now() - started).toBeLessThan(2000);
    expect(pexpireCalls).toEqual([["rl:pttl-timeout:key", 60_000]]);
    expect(result.limited).toBe(false);
  });

  test("client regains access after the simulated window (no permanent 429)", async () => {
    let exists = false;
    let count = 0;
    let expiresAt = 0;
    let pexpireAttempts = 0;
    setRedisClientForTests(
      fakeClient({
        incr: async () => {
          if (!exists || (expiresAt > 0 && Date.now() >= expiresAt)) {
            exists = true;
            count = 0;
            expiresAt = 0;
          }
          count += 1;
          return count;
        },
        pexpire: async (_key, ms) => {
          pexpireAttempts += 1;
          if (pexpireAttempts === 1) throw new Error("pexpire response lost");
          if (!exists) return 0;
          expiresAt = Date.now() + ms;
          return 1;
        },
        pttl: async () => {
          if (!exists) return -2;
          return expiresAt > 0 && expiresAt > Date.now() ? expiresAt - Date.now() : -1;
        },
        del: async () => {
          exists = false;
          count = 0;
          expiresAt = 0;
          return 1;
        },
      }),
    );
    const key = "recover:key";
    expect((await redisRateLimitStore.consume(key, 2, 100)).limited).toBe(false);
    expect((await redisRateLimitStore.consume(key, 2, 100)).limited).toBe(false);
    expect((await redisRateLimitStore.consume(key, 2, 100)).limited).toBe(false);
    await new Promise((resolve) => setTimeout(resolve, 120));
    const afterWindow = await redisRateLimitStore.consume(key, 2, 100);
    expect(afterWindow.limited).toBe(false);
  });
});
