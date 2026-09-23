import { describe, expect, test } from "bun:test";
import {
  deriveFileIdempotencyKey,
  generateIdempotencyKey,
  normalizeIdempotencyKey,
} from "./idempotency";

describe("idempotency helpers", () => {
  test("generateIdempotencyKey returns a valid UUID v4 format string", () => {
    const key1 = generateIdempotencyKey();
    const key2 = generateIdempotencyKey();
    expect(key1).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );
    expect(key2).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );
    expect(key1).not.toBe(key2);
  });

  test("normalizeIdempotencyKey validates length (8–128 chars)", () => {
    expect(normalizeIdempotencyKey("short")).toBeNull();
    expect(normalizeIdempotencyKey("")).toBeNull();
    expect(normalizeIdempotencyKey(null)).toBeNull();
    expect(normalizeIdempotencyKey(undefined)).toBeNull();
    expect(normalizeIdempotencyKey(123)).toBeNull();
    expect(normalizeIdempotencyKey("a".repeat(129))).toBeNull();

    expect(normalizeIdempotencyKey("12345678")).toBe("12345678");
    expect(normalizeIdempotencyKey("  valid-key-123  ")).toBe("valid-key-123");
    expect(normalizeIdempotencyKey("a".repeat(128))).toBe("a".repeat(128));
  });

  test("deriveFileIdempotencyKey creates unique per-file keys in a batch", () => {
    const batchKey = "550e8400-e29b-41d4-a716-446655440000";
    const keyA = deriveFileIdempotencyKey(batchKey, 0);
    const keyB = deriveFileIdempotencyKey(batchKey, 1);
    const keyC = deriveFileIdempotencyKey(batchKey, 2);

    expect(keyA).toBe(`${batchKey}-0`);
    expect(keyB).toBe(`${batchKey}-1`);
    expect(keyC).toBe(`${batchKey}-2`);

    expect(keyA).not.toBe(keyB);
    expect(keyB).not.toBe(keyC);

    // Length is within 8–128
    expect(keyA.length).toBeGreaterThanOrEqual(8);
    expect(keyA.length).toBeLessThanOrEqual(128);
  });

  test("deriveFileIdempotencyKey preserves exact keys on retry of same batch", () => {
    const batchKey = "550e8400-e29b-41d4-a716-446655440000";
    // First attempt
    const attempt1_A = deriveFileIdempotencyKey(batchKey, 0);
    const attempt1_B = deriveFileIdempotencyKey(batchKey, 1);

    // Second attempt (retry of same logical form submission)
    const attempt2_A = deriveFileIdempotencyKey(batchKey, 0);
    const attempt2_B = deriveFileIdempotencyKey(batchKey, 1);

    expect(attempt1_A).toBe(attempt2_A);
    expect(attempt1_B).toBe(attempt2_B);
  });

  test("deriveFileIdempotencyKey yields different keys for a new submission batch", () => {
    const batchKey1 = generateIdempotencyKey();
    const batchKey2 = generateIdempotencyKey();

    const file1 = deriveFileIdempotencyKey(batchKey1, 0);
    const file2 = deriveFileIdempotencyKey(batchKey2, 0);

    expect(file1).not.toBe(file2);
  });
});
