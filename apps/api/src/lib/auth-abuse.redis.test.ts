import { afterEach, describe, expect, test } from "bun:test";

import {
  accountAttemptKey,
  clearAccountFailures,
  clearLoginFailures,
  getAccountDelayMs,
  getLoginDelayMs,
  loginAttemptKey,
  recordAccountFailure,
  recordLoginFailure,
  resetAccountAttemptStore,
  resetLoginAttemptStore,
  setAbuseRedisForTests,
} from "./auth-abuse";

type FakeRedis = {
  incr(key: string): Promise<number>;
  pexpire(key: string, ms: number): Promise<number>;
  get(key: string): Promise<string | null>;
  set(
    key: string,
    value: string,
    opts?: { px?: number; nx?: boolean },
  ): Promise<string | null>;
  del(key: string): Promise<number>;
};

function statefulClient(): { client: FakeRedis; store: Map<string, string> } {
  const store = new Map<string, string>();
  return {
    store,
    client: {
      async incr(key) {
        const next = Number(store.get(key) ?? "0") + 1;
        store.set(key, String(next));
        return next;
      },
      async pexpire() {
        return 1;
      },
      async get(key) {
        return store.get(key) ?? null;
      },
      async set(key, value) {
        store.set(key, value);
        return "OK";
      },
      async del(key) {
        return store.delete(key) ? 1 : 0;
      },
    },
  };
}

function stalledClient(): FakeRedis {
  return {
    incr: () => new Promise<number>(() => {}),
    pexpire: () => new Promise<number>(() => {}),
    get: () => new Promise<string | null>(() => {}),
    set: () => new Promise<string | null>(() => {}),
    del: () => new Promise<number>(() => {}),
  };
}

function throwingClient(): FakeRedis {
  const boom = async (): Promise<never> => {
    throw new Error("boom");
  };
  return {
    incr: boom,
    pexpire: boom,
    get: boom,
    set: boom,
    del: boom,
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

describe("auth abuse redis guard", () => {
  afterEach(() => {
    resetLoginAttemptStore();
    resetAccountAttemptStore();
    setAbuseRedisForTests(undefined);
    delete process.env.REDIS_TIMEOUT_MS;
  });

  test("healthy redis drives the login threshold, lock read, and clear", async () => {
    const { client } = statefulClient();
    setAbuseRedisForTests(client);
    const key = loginAttemptKey("user@example.com", "1.1.1.1");

    expect(await recordLoginFailure(key)).toBe(0);
    expect(await recordLoginFailure(key)).toBe(0);
    expect(await recordLoginFailure(key)).toBeGreaterThan(0);
    expect(await getLoginDelayMs(key)).toBeGreaterThan(0);

    await clearLoginFailures(key);
    expect(await getLoginDelayMs(key)).toBe(0);
  });

  test("healthy redis drives the account threshold and clear", async () => {
    const { client } = statefulClient();
    setAbuseRedisForTests(client);
    const key = accountAttemptKey("user@example.com");

    for (let i = 0; i < 9; i += 1) {
      expect(await recordAccountFailure(key)).toBe(0);
    }
    expect(await recordAccountFailure(key)).toBeGreaterThan(0);
    expect(await getAccountDelayMs(key)).toBeGreaterThan(0);

    await clearAccountFailures(key);
    expect(await getAccountDelayMs(key)).toBe(0);
  });

  test("stalled redis degrades the login throttle to memory within the bound", async () => {
    process.env.REDIS_TIMEOUT_MS = "50";
    setAbuseRedisForTests(stalledClient());
    const { lines, restore } = captureWarns();
    const key = loginAttemptKey("slow@example.com", "2.2.2.2");
    try {
      const started = Date.now();
      expect(await recordLoginFailure(key)).toBe(0);
      expect(await recordLoginFailure(key)).toBe(0);
      expect(await recordLoginFailure(key)).toBeGreaterThan(0);
      expect(await getLoginDelayMs(key)).toBeGreaterThan(0);
      expect(Date.now() - started).toBeLessThan(2000);
      expect(
        lines.some((l) =>
          l.includes("[redis] auth-abuse incr login failures timeout"),
        ),
      ).toBe(true);
      expect(
        lines.some((l) =>
          l.includes("[redis] auth-abuse get login lock timeout"),
        ),
      ).toBe(true);
    } finally {
      restore();
    }
  });

  test("throwing redis degrades the login throttle to memory without throwing", async () => {
    setAbuseRedisForTests(throwingClient());
    const { lines, restore } = captureWarns();
    const key = loginAttemptKey("err@example.com", "3.3.3.3");
    try {
      expect(await recordLoginFailure(key)).toBe(0);
      expect(await recordLoginFailure(key)).toBe(0);
      expect(await recordLoginFailure(key)).toBeGreaterThan(0);
      expect(await getLoginDelayMs(key)).toBeGreaterThan(0);
      expect(
        lines.some((l) =>
          l.includes("[redis] auth-abuse incr login failures failed"),
        ),
      ).toBe(true);
    } finally {
      restore();
    }
  });

  test("throwing redis degrades the account throttle to memory", async () => {
    setAbuseRedisForTests(throwingClient());
    const { lines, restore } = captureWarns();
    const key = accountAttemptKey("err@example.com");
    try {
      for (let i = 0; i < 9; i += 1) {
        expect(await recordAccountFailure(key)).toBe(0);
      }
      expect(await recordAccountFailure(key)).toBeGreaterThan(0);
      expect(await getAccountDelayMs(key)).toBeGreaterThan(0);
      expect(
        lines.some((l) =>
          l.includes("[redis] auth-abuse get account lock failed"),
        ),
      ).toBe(true);
    } finally {
      restore();
    }
  });

  test("stalled lock read falls back to a memory lock recorded during the outage", async () => {
    process.env.REDIS_TIMEOUT_MS = "50";
    const key = loginAttemptKey("outage@example.com", "4.4.4.4");
    setAbuseRedisForTests(null);
    await recordLoginFailure(key);
    await recordLoginFailure(key);
    await recordLoginFailure(key);

    setAbuseRedisForTests(stalledClient());
    const { restore } = captureWarns();
    try {
      const started = Date.now();
      expect(await getLoginDelayMs(key)).toBeGreaterThan(0);
      expect(Date.now() - started).toBeLessThan(2000);
    } finally {
      restore();
    }
  });

  test("stalled clear never hangs, throws, or leaves the memory lock behind", async () => {
    process.env.REDIS_TIMEOUT_MS = "50";
    const key = loginAttemptKey("clear@example.com", "5.5.5.5");
    setAbuseRedisForTests(null);
    await recordLoginFailure(key);
    await recordLoginFailure(key);
    await recordLoginFailure(key);
    expect(await getLoginDelayMs(key)).toBeGreaterThan(0);

    setAbuseRedisForTests(stalledClient());
    const { restore } = captureWarns();
    try {
      const started = Date.now();
      await clearLoginFailures(key);
      expect(Date.now() - started).toBeLessThan(2000);
      expect(await getLoginDelayMs(key)).toBe(0);
    } finally {
      restore();
    }
  });

  test("throwing clear never throws", async () => {
    const key = accountAttemptKey("clear@example.com");
    setAbuseRedisForTests(null);
    await recordAccountFailure(key);
    setAbuseRedisForTests(throwingClient());
    const { restore } = captureWarns();
    try {
      await clearAccountFailures(key);
    } finally {
      restore();
    }
  });
});
