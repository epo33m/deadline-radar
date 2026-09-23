import { describe, expect, test } from "bun:test";

import { mapWithLimit } from "./concurrency";

describe("mapWithLimit", () => {
  test("preserves result order", async () => {
    const out = await mapWithLimit([1, 2, 3, 4], 2, async (n) => n * 10);
    expect(out).toEqual([10, 20, 30, 40]);
  });

  test("never exceeds the limit in flight", async () => {
    let inFlight = 0;
    let maxInFlight = 0;
    await mapWithLimit(Array.from({ length: 10 }, (_, i) => i), 3, async (n) => {
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise((r) => setTimeout(r, 1));
      inFlight -= 1;
      return n;
    });
    expect(maxInFlight).toBeLessThanOrEqual(3);
    expect(maxInFlight).toBeGreaterThan(1);
  });

  test("handles empty input and limit larger than input", async () => {
    expect(await mapWithLimit([], 5, async (n: number) => n)).toEqual([]);
    expect(await mapWithLimit([7], 5, async (n) => n + 1)).toEqual([8]);
  });
});
