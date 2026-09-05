import { describe, expect, test } from "bun:test";

import { AUTH_BRIDGE_HEADER, isAuthBridgeRequest } from "./auth-bridge";

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
