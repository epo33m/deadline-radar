import { describe, expect, test } from "bun:test";

import {
  AUTH_BRIDGE_HEADER,
  isAuthBridgeRequest,
  timingSafeEqualString,
} from "./auth-bridge";

process.env.AUTH_BRIDGE_SECRET = "correct-bridge-secret";

describe("auth bridge secret", () => {
  test("rejects missing header", () => {
    expect(isAuthBridgeRequest(new Request("http://localhost"))).toBe(false);
  });

  test("rejects legacy value 1", () => {
    expect(
      isAuthBridgeRequest(
        new Request("http://localhost", {
          headers: { [AUTH_BRIDGE_HEADER]: "1" },
        }),
      ),
    ).toBe(false);
  });

  test("accepts matching secret", () => {
    expect(
      isAuthBridgeRequest(
        new Request("http://localhost", {
          headers: { [AUTH_BRIDGE_HEADER]: "correct-bridge-secret" },
        }),
      ),
    ).toBe(true);
  });
});

describe("timingSafeEqualString (shared with cron auth)", () => {
  test("equal strings match", () => {
    expect(timingSafeEqualString("Bearer abc", "Bearer abc")).toBe(true);
    expect(timingSafeEqualString("", "")).toBe(true);
  });

  test("same-length mismatch is false", () => {
    expect(timingSafeEqualString("Bearer abc", "Bearer abd")).toBe(false);
  });

  test("different lengths reject cleanly without throwing", () => {
    expect(timingSafeEqualString("short", "much-longer-secret")).toBe(false);
    expect(timingSafeEqualString("", "nonempty")).toBe(false);
  });
});
