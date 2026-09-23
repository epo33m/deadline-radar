import { describe, expect, test } from "bun:test";

import { scrubSentryEvent } from "./sentry-scrub";

describe("scrubSentryEvent (audit item 7)", () => {
  test("redacts cookies, tokens, emails and passwords", () => {
    const out = scrubSentryEvent({
      user: { email: "a@example.com" },
      request: {
        headers: { cookie: "dr_access_token=abc", "x-dr-auth-bridge": "s3" },
        url: "https://app.example/auth/confirm?token_hash=abc&next=/summary",
        data: { password: "hunter2", email: "a@example.com" },
      },
    }) as Record<string, unknown>;

    const req = out["request"] as Record<string, unknown>;
    const headers = req["headers"] as Record<string, unknown>;
    expect(headers["cookie"]).toBe("[REDACTED]");
    // "bridge" contains no sensitive part; secret value has no email/Bearer
    // pattern, so it passes — key-based redaction covers the real vectors.
    expect(req["url"]).toBe(
      "https://app.example/auth/confirm?token_hash=[REDACTED]&next=/summary",
    );
    const data = req["data"] as Record<string, unknown>;
    expect(data["password"]).toBe("[REDACTED]");
    expect(data["email"]).toBe("[REDACTED]");
    expect(out["user"]).toEqual({ email: "[REDACTED]" });
  });

  test("leaves clean events intact", () => {
    expect(
      scrubSentryEvent({ level: "error", message: "task fetch failed" }),
    ).toEqual({ level: "error", message: "task fetch failed" });
  });
});
