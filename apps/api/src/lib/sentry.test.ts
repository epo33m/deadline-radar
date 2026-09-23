import { describe, expect, test } from "bun:test";

import { scrubSentryEvent } from "./sentry";

describe("scrubSentryEvent (audit item 7)", () => {
  test("redacts auth headers, cookies, tokens and emails", () => {
    const out = scrubSentryEvent({
      user: { id: "u-1", email: "a@example.com", username: "a" },
      request: {
        headers: {
          authorization: "Bearer secret-token",
          cookie: "dr_access_token=abc",
          "content-type": "application/json",
        },
        query_string: "code=otp-secret&next=/summary",
        data: { email: "a@example.com", password: "hunter2" },
      },
      extra: { resendApiKey: "re_xyz" },
    }) as Record<string, unknown>;

    const user = out["user"] as Record<string, unknown>;
    expect(user["id"]).toBe("u-1");
    expect(user["email"]).toBe("[REDACTED]");

    const req = out["request"] as Record<string, unknown>;
    const headers = req["headers"] as Record<string, unknown>;
    expect(headers["authorization"]).toBe("[REDACTED]");
    expect(headers["cookie"]).toBe("[REDACTED]");
    expect(headers["content-type"]).toBe("application/json");
    expect(req["query_string"]).toBe("[REDACTED]");
    const data = req["data"] as Record<string, unknown>;
    expect(data["password"]).toBe("[REDACTED]");
    expect(out["extra"]).toEqual({ resendApiKey: "[REDACTED]" });
  });

  test("scrubs PII inside free-text strings, keeps clean events intact", () => {
    const out = scrubSentryEvent({
      message: "login failed for a@example.com with Bearer abc123",
      level: "error",
    }) as Record<string, unknown>;
    expect(out["message"]).toBe(
      "login failed for [REDACTED] with Bearer [REDACTED]",
    );
    expect(out["level"]).toBe("error");
  });
});
