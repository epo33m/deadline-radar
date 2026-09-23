/**
 * Finding #8 tests for storage operation resilience.
 * - B: thrown transport failures retry, then succeed.
 * - C: returned provider errors are definitive (no retry).
 * - E: repeated transport failures stop at the attempt budget.
 * - D: upload never retries a definitive answer; attempts stay bounded.
 */
import { describe, expect, test } from "bun:test";

import {
  storageRemove,
  storageSignedUrl,
  storageUpload,
  type ServiceClient,
} from "./storage";

function fakeClient(
  behavior: (op: string) => Promise<unknown>,
): ServiceClient {
  return {
    storage: {
      from: () => ({
        upload: (key: string, bytes: ArrayBuffer) =>
          behavior(`upload:${key}:${bytes.byteLength}`),
        remove: (keys: string[]) => behavior(`remove:${keys.join(",")}`),
        createSignedUrl: (key: string, expires: number) =>
          behavior(`signedUrl:${key}:${expires}`),
      }),
    },
  } as unknown as ServiceClient;
}

describe("finding #8 — storage resilience", () => {
  test("B. thrown transport failures retry, then succeed", async () => {
    let calls = 0;
    const client = fakeClient(async () => {
      calls += 1;
      if (calls < 3) throw new Error("fetch failed: socket hang up");
      return { data: [], error: null };
    });
    const result = await storageRemove(client, ["a/b.pdf"]);
    expect((result as { error: null }).error).toBeNull();
    expect(calls).toBe(3);
  });

  test("C. returned provider error is definitive (single attempt)", async () => {
    let calls = 0;
    const client = fakeClient(async () => {
      calls += 1;
      return { data: null, error: { message: "Duplicate" } };
    });
    const result = (await storageUpload(
      client,
      "a/b.pdf",
      new ArrayBuffer(4),
      "application/pdf",
    )) as { error: { message: string } | null };
    expect(result.error?.message).toBe("Duplicate");
    expect(calls).toBe(1);
  });

  test("E. repeated transport failures stop at the budget", async () => {
    let calls = 0;
    const client = fakeClient(async () => {
      calls += 1;
      throw new Error("fetch failed: econnreset");
    });
    await expect(storageSignedUrl(client, "a/b.pdf", 600)).rejects.toThrow(
      "econnreset",
    );
    expect(calls).toBe(3);
  });

  test("D. upload attempts stay bounded on persistent transport failure", async () => {
    let calls = 0;
    const client = fakeClient(async () => {
      calls += 1;
      throw new Error("fetch failed: econnreset");
    });
    await expect(
      storageUpload(client, "a/b.pdf", new ArrayBuffer(4), "application/pdf"),
    ).rejects.toThrow("econnreset");
    expect(calls).toBe(3);
  });
});
