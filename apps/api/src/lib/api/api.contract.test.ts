import { describe, expect, test } from "bun:test";

import {
  ApiError,
  API_ERROR_CODES,
  decodeCursor,
  encodeCursor,
  normalizeRequestId,
  parsePaginationQuery,
  toErrorBody,
} from "./index";

describe("API error envelope", () => {
  test("toErrorBody shapes nested error with requestId", () => {
    const body = toErrorBody(
      ApiError.validation("Request validation failed", [
        { field: "title", message: "Required" },
      ]),
      "req-1",
    );
    expect(body).toEqual({
      error: {
        code: API_ERROR_CODES.VALIDATION_ERROR,
        message: "Request validation failed",
        details: [{ field: "title", message: "Required" }],
      },
      requestId: "req-1",
    });
  });

  test("internal errors do not expose details", () => {
    const body = toErrorBody(ApiError.internal("secret db failure"), "r2");
    expect(body.error.message).toBe("Internal server error");
    expect(body.error.details).toEqual([]);
  });
});

describe("requestId", () => {
  test("accepts valid UUID client ids", () => {
    const id = "550e8400-e29b-41d4-a716-446655440000";
    expect(normalizeRequestId(id)).toBe(id);
  });

  test("rejects arbitrary client ids", () => {
    const id = normalizeRequestId("not-a-uuid<script>");
    expect(id).not.toBe("not-a-uuid<script>");
    expect(id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );
  });
});

describe("pagination", () => {
  test("defaults and clamps", () => {
    expect(parsePaginationQuery({}).limit).toBe(50);
    expect(parsePaginationQuery({ limit: "10" }).limit).toBe(10);
  });

  test("rejects oversized limit", () => {
    expect(() => parsePaginationQuery({ limit: "100000" })).toThrow();
  });

  test("round-trips cursors", () => {
    const encoded = encodeCursor({
      v: 1,
      k: "2026-01-01T00:00:00.000Z",
      id: "abc",
    });
    expect(decodeCursor(encoded)).toEqual({
      v: 1,
      k: "2026-01-01T00:00:00.000Z",
      id: "abc",
    });
  });

  test("rejects invalid cursors", () => {
    expect(() => decodeCursor("!!!")).toThrow();
  });
});
