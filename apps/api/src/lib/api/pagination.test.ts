import { describe, expect, test } from "bun:test";
import { decodeCursor, encodeCursor, parsePaginationQuery } from "./pagination";
import { ApiError } from "./errors";

describe("Finding L-3: Cursor UUID validation & pagination", () => {
  const validUuid = "12345678-1234-4234-8234-123456789abc";
  const validIso = "2026-09-19T10:00:00.000Z";

  test("valid cursor with valid UUID decodes successfully", () => {
    const encoded = encodeCursor({
      v: 1,
      k: validIso,
      id: validUuid,
    });
    const decoded = decodeCursor(encoded);
    expect(decoded).toEqual({
      v: 1,
      k: validIso,
      id: validUuid,
    });
  });

  test("cursor with non-UUID string id throws 400 validation error", () => {
    const maliciousPayload = {
      v: 1,
      k: validIso,
      id: "x",
    };
    const encoded = Buffer.from(JSON.stringify(maliciousPayload), "utf8").toString("base64url");
    try {
      decodeCursor(encoded);
      expect().fail("should have thrown ApiError");
    } catch (err) {
      expect(err instanceof ApiError).toBe(true);
      const apiErr = err as ApiError;
      expect(apiErr.status).toBe(400);
      expect(apiErr.code).toBe("VALIDATION_ERROR");
      expect(apiErr.details).toEqual([
        { field: "cursor", message: "Cursor is invalid or expired" },
      ]);
    }
  });

  test("cursor with SQL injection attempt in id throws 400 validation error", () => {
    const sqlInjectionPayload = {
      v: 1,
      k: validIso,
      id: "12345678-1234-4234-8234-123456789abc' OR '1'='1",
    };
    const encoded = Buffer.from(JSON.stringify(sqlInjectionPayload), "utf8").toString("base64url");
    expect(() => decodeCursor(encoded)).toThrow(ApiError);
  });

  test("cursor with missing id throws 400 validation error", () => {
    const missingIdPayload = {
      v: 1,
      k: validIso,
    };
    const encoded = Buffer.from(JSON.stringify(missingIdPayload), "utf8").toString("base64url");
    expect(() => decodeCursor(encoded)).toThrow(ApiError);
  });

  test("cursor with missing k throws 400 validation error", () => {
    const missingKPayload = {
      v: 1,
      id: validUuid,
    };
    const encoded = Buffer.from(JSON.stringify(missingKPayload), "utf8").toString("base64url");
    expect(() => decodeCursor(encoded)).toThrow(ApiError);
  });

  test("cursor with unparseable sort key k throws 400 validation error", () => {
    const invalidKPayload = {
      v: 1,
      k: "not-a-date",
      id: validUuid,
    };
    const encoded = Buffer.from(JSON.stringify(invalidKPayload), "utf8").toString("base64url");
    expect(() => decodeCursor(encoded)).toThrow(ApiError);
  });

  test("cursor with invalid base64 throws 400 validation error", () => {
    expect(() => decodeCursor("!!!not_base64!!!")).toThrow(ApiError);
  });

  test("cursor with malformed JSON throws 400 validation error", () => {
    const badJson = Buffer.from("{invalid json", "utf8").toString("base64url");
    expect(() => decodeCursor(badJson)).toThrow(ApiError);
  });

  test("cursor with version !== 1 throws 400 validation error", () => {
    const badVersion = {
      v: 2,
      k: validIso,
      id: validUuid,
    };
    const encoded = Buffer.from(JSON.stringify(badVersion), "utf8").toString("base64url");
    expect(() => decodeCursor(encoded)).toThrow(ApiError);
  });

  test("undefined or empty cursor returns null", () => {
    expect(decodeCursor(undefined)).toBeNull();
    expect(decodeCursor("")).toBeNull();
  });

  test("parsePaginationQuery parses valid query parameters", () => {
    const result = parsePaginationQuery({ limit: "25" });
    expect(result.limit).toBe(25);
  });
});
