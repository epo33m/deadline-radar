import { describe, expect, test } from "bun:test";

import { stripAuthTokens, type AuthTokenBody } from "./cookies";

describe("stripAuthTokens", () => {
  test("removes access and refresh tokens from bridge payloads", () => {
    const input: AuthTokenBody & {
      redirectTo: string;
      user: { id: string };
    } = {
      redirectTo: "/overview",
      accessToken: "secret-access",
      refreshToken: "secret-refresh",
      expiresIn: 3600,
      user: { id: "u1" },
    };
    const safe = stripAuthTokens(input);

    expect(safe).toEqual({
      redirectTo: "/overview",
      user: { id: "u1" },
    });
    expect("accessToken" in safe).toBe(false);
    expect("refreshToken" in safe).toBe(false);
    expect("expiresIn" in safe).toBe(false);
  });
});
