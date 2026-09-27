process.env.NODE_ENV = "test";
import { afterEach, describe, expect, test } from "bun:test";

import {
  getRedis,
  resetRedisClient,
  setRedisClientForTests,
} from "./redis";

function clearEnv(): (string | undefined)[] {
  const keys = [
    "UPSTASH_REDIS_REST_URL",
    "UPSTASH_REDIS_REST_TOKEN",
    "REDIS_URL",
  ];
  const saved = keys.map((k) => process.env[k]);
  for (const k of keys) delete process.env[k];
  return saved;
}

describe("getRedis transport selection", () => {
  let saved: (string | undefined)[] = [];

  afterEach(() => {
    resetRedisClient();
    const keys = [
      "UPSTASH_REDIS_REST_URL",
      "UPSTASH_REDIS_REST_TOKEN",
      "REDIS_URL",
    ];
    keys.forEach((k, i) => {
      if (saved[i] === undefined) delete process.env[k];
      else process.env[k] = saved[i];
    });
  });

  test("returns null when nothing is configured", async () => {
    saved = clearEnv();
    expect(await getRedis()).toBeNull();
  });

  test("REST configured returns a client without connecting", async () => {
    // Upstash REST is HTTP per-request: construction never dials, so even a
    // bogus host yields a client here. Per-command failures are contained
    // by withRedisTimeout + the memory fallback (see rate-limit tests).
    saved = clearEnv();
    process.env.UPSTASH_REDIS_REST_URL = "https://127.0.0.1:1";
    process.env.UPSTASH_REDIS_REST_TOKEN = "bogus";
    const client = await getRedis();
    expect(client).not.toBeNull();
    expect(typeof client!.incr).toBe("function");
  });

  test("injected client wins over env (memoized)", async () => {
    saved = clearEnv();
    process.env.UPSTASH_REDIS_REST_URL = "https://127.0.0.1:1";
    process.env.UPSTASH_REDIS_REST_TOKEN = "bogus";
    const fake = {
      incr: async () => 1,
      pexpire: async () => 1,
      get: async () => null,
      set: async () => "OK",
      del: async () => 0,
    };
    setRedisClientForTests(fake);
    expect(await getRedis()).toBe(fake);
  });
});
