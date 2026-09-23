/**
 * Finding #8 tests for the net resilience helpers.
 * - A: a hanging operation aborts within the configured timeout.
 * - B: transient failures are retried with bounded backoff, then succeed.
 * - C: non-retryable errors are attempted exactly once.
 * - E: repeated transient failures stop after the attempt budget.
 */
import { describe, expect, test } from "bun:test";

import {
  backoffDelayMs,
  fetchWithTimeout,
  isTransportError,
  withResilience,
} from "./net";

describe("fetchWithTimeout", () => {
  test("A. aborts a hanging server within the timeout", async () => {
    const server = Bun.serve({
      port: 0,
      fetch: () => new Promise<Response>(() => {}),
    });
    try {
      const started = Date.now();
      let error: unknown;
      try {
        await fetchWithTimeout(`http://127.0.0.1:${server.port}/hang`, {}, 100);
      } catch (e) {
        error = e;
      }
      expect(error).toBeInstanceOf(Error);
      expect(Date.now() - started).toBeLessThan(5000);
    } finally {
      server.stop(true);
    }
  });
});

describe("withResilience", () => {
  test("A. hanging operation aborts, no promise left pending", async () => {
    const started = Date.now();
    let error: unknown;
    try {
      await withResilience(
        (signal) =>
          new Promise<string>((_resolve, reject) => {
            signal.addEventListener("abort", () => {
              reject(signal.reason);
            });
          }),
        { timeoutMs: 80, attempts: 1 },
      );
    } catch (e) {
      error = e;
    }
    expect(error).toBeDefined();
    expect(Date.now() - started).toBeLessThan(5000);
  });

  test("B. transient failures retry with bounded backoff then succeed", async () => {
    let calls = 0;
    const delays: number[] = [];
    const result = await withResilience(
      async () => {
        calls += 1;
        if (calls < 3) throw new Error("fetch failed: socket hang up");
        return "ok";
      },
      {
        timeoutMs: 1000,
        attempts: 3,
        baseDelayMs: 10,
        maxDelayMs: 40,
        sleepFn: async (ms) => {
          delays.push(ms);
        },
      },
    );
    expect(result).toBe("ok");
    expect(calls).toBe(3);
    expect(delays.length).toBe(2);
    // Exponential, capped: attempt1 ∈ [5,10], attempt2 ∈ [10,20].
    expect(delays[0]).toBeGreaterThanOrEqual(5);
    expect(delays[0]).toBeLessThanOrEqual(10);
    expect(delays[1]).toBeGreaterThanOrEqual(10);
    expect(delays[1]).toBeLessThanOrEqual(20);
  });

  test("C. non-retryable error is attempted exactly once", async () => {
    let calls = 0;
    await expect(
      withResilience(
        async () => {
          calls += 1;
          throw new Error("validation failed");
        },
        { attempts: 3, retryIf: () => false },
      ),
    ).rejects.toThrow("validation failed");
    expect(calls).toBe(1);
  });

  test("E. repeated transient failures stop at the attempt budget", async () => {
    let calls = 0;
    await expect(
      withResilience(
        async () => {
          calls += 1;
          throw new Error("fetch failed: econnreset");
        },
        {
          attempts: 4,
          baseDelayMs: 1,
          maxDelayMs: 2,
          sleepFn: async () => {},
        },
      ),
    ).rejects.toThrow("econnreset");
    expect(calls).toBe(4);
  });
});

describe("backoffDelayMs", () => {
  test("grows exponentially within [cap/2, cap]", () => {
    expect(backoffDelayMs(1, 500, 5000, () => 0)).toBe(250);
    expect(backoffDelayMs(1, 500, 5000, () => 1)).toBe(500);
    expect(backoffDelayMs(3, 500, 5000, () => 1)).toBe(2000);
    expect(backoffDelayMs(10, 500, 1000, () => 1)).toBe(1000);
  });
});

describe("isTransportError", () => {
  test("matches aborts and network failures only", () => {
    const abort = new Error("x");
    abort.name = "AbortError";
    expect(isTransportError(abort)).toBe(true);
    expect(isTransportError(new Error("fetch failed boom"))).toBe(true);
    expect(isTransportError(new Error("application error"))).toBe(false);
    expect(isTransportError("string")).toBe(false);
  });
});
