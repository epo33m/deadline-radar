import { describe, expect, test } from "bun:test";

import { mapWithConcurrency } from "./concurrency";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe("mapWithConcurrency", () => {
  test("never exceeds the bound under a burst", async () => {
    let inFlight = 0;
    let maxInFlight = 0;
    const items = Array.from({ length: 12 }, (_, i) => i);
    await mapWithConcurrency(items, 3, async () => {
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await sleep(10 + Math.random() * 20);
      inFlight -= 1;
      return true;
    });
    expect(maxInFlight).toBeLessThanOrEqual(3);
    expect(maxInFlight).toBeGreaterThan(1); // actually parallel, not serial
  });

  test("respects the bound of 1 (serial) when requested", async () => {
    let inFlight = 0;
    let maxInFlight = 0;
    await mapWithConcurrency([1, 2, 3], 1, async () => {
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await sleep(5);
      inFlight -= 1;
    });
    expect(maxInFlight).toBe(1);
  });

  test("stops dispatching after the first error and reports its index", async () => {
    const started: number[] = [];
    const items = [0, 1, 2, 3, 4, 5];
    const { results, failureIndex } = await mapWithConcurrency(
      items,
      2,
      async (n) => {
        started.push(n);
        await sleep(n === 1 ? 5 : 20);
        return n === 1 ? { error: "boom" } : { ok: true };
      },
      (r) => "error" in r,
    );
    expect(failureIndex).toBe(1);
    // In-flight sibling (0) settles; nothing new is dispatched past the failure.
    expect(started).toEqual([0, 1]);
    expect(results[1]).toEqual({ error: "boom" });
  });

  test("preserves dispatch index into the worker (per-file idempotency keys)", async () => {
    const seen: Array<[number, number]> = [];
    const items = ["a", "b", "c", "d"];
    await mapWithConcurrency(items, 4, async (item, index) => {
      seen.push([items.indexOf(item), index]);
      return index;
    });
    expect(seen.map((entry) => entry[1]).sort()).toEqual([0, 1, 2, 3]);
    expect(seen.every(([itemIdx, index]) => itemIdx === index)).toBe(true);
  });

  test("handles an empty list", async () => {
    const { results, failureIndex } = await mapWithConcurrency([], 4, async () => 1);
    expect(results).toEqual([]);
    expect(failureIndex).toBeUndefined();
  });
});
