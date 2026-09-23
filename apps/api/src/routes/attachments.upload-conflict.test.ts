import { describe, expect, test } from "bun:test";
import { isStorageDuplicateError } from "../lib/storage";
import { ApiError } from "../lib/api/errors";

describe("Finding L-4: Duplicate attachment upload & storage error mapping", () => {
  test("isStorageDuplicateError identifies various duplicate error shapes", () => {
    expect(isStorageDuplicateError({ message: "The resource already exists" })).toBe(true);
    expect(isStorageDuplicateError({ message: "Duplicate" })).toBe(true);
    expect(isStorageDuplicateError({ message: "Key already exists" })).toBe(true);
    expect(isStorageDuplicateError({ statusCode: 409 })).toBe(true);
    expect(isStorageDuplicateError({ statusCode: "409" })).toBe(true);
    expect(isStorageDuplicateError({ error: "Duplicate" })).toBe(true);
  });

  test("isStorageDuplicateError rejects genuine outage / infrastructure errors", () => {
    expect(isStorageDuplicateError({ message: "Connection refused", statusCode: 502 })).toBe(false);
    expect(isStorageDuplicateError({ message: "Internal server error", statusCode: 500 })).toBe(false);
    expect(isStorageDuplicateError({ message: "Request timed out" })).toBe(false);
    expect(isStorageDuplicateError(null)).toBe(false);
    expect(isStorageDuplicateError(undefined)).toBe(false);
    expect(isStorageDuplicateError("string error")).toBe(false);
  });

  test("ApiError.conflict format is consistent with API standard", () => {
    const err = ApiError.conflict("An attachment with this file name already exists for this task");
    expect(err.status).toBe(409);
    expect(err.code).toBe("CONFLICT");
    expect(err.message).toBe("An attachment with this file name already exists for this task");
  });

  test("ApiError dependency failure format is consistent for genuine outages", () => {
    const err = new ApiError({
      status: 502,
      code: "DEPENDENCY_FAILURE",
      message: "Unable to store attachment",
    });
    expect(err.status).toBe(502);
    expect(err.code).toBe("DEPENDENCY_FAILURE");
  });
});
