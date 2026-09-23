// RF-13: pure helpers that drive the fail-closed Resend boot guard. The
// process.env-dependent assertStartupConfig wiring is covered in env.test.ts.
import { describe, expect, test } from "bun:test";

import {
  extractEmailFromHeader,
  isResendApiKeyShape,
  isSandboxFromEmail,
  resendConfigProblem,
} from "./resend-config";

describe("RF-13 — isResendApiKeyShape", () => {
  test("accepts the canonical re_ prefix with normal key characters", () => {
    expect(isResendApiKeyShape("re_abc123DEF-_")).toBe(true);
  });

  test("rejects non re_* prefixes and empty/blank values", () => {
    expect(isResendApiKeyShape("sk_live_abc")).toBe(false);
    expect(isResendApiKeyShape("")).toBe(false);
    expect(isResendApiKeyShape("re_ with space")).toBe(false);
  });
});

describe("RF-13 — extractEmailFromHeader", () => {
  test("accepts the display-name header form", () => {
    expect(
      extractEmailFromHeader("Deadline Radar <reminders@example.com>"),
    ).toBe("reminders@example.com");
  });

  test("accepts a bare address", () => {
    expect(extractEmailFromHeader("reminders@example.com")).toBe(
      "reminders@example.com",
    );
  });

  test("rejects non-address strings", () => {
    expect(extractEmailFromHeader("not-an-email")).toBeNull();
    expect(extractEmailFromHeader("reminders@nodot")).toBeNull();
    expect(extractEmailFromHeader("")).toBeNull();
  });
});

describe("RF-13 — isSandboxFromEmail", () => {
  test("flags resend.dev and subdomains", () => {
    expect(isSandboxFromEmail("Owner <onboarding@resend.dev>")).toBe(true);
    expect(isSandboxFromEmail("hi@team.resend.dev")).toBe(true);
  });

  test("does not flag verified domains", () => {
    expect(isSandboxFromEmail("Deadline Radar <hi@example.com>")).toBe(false);
    expect(isSandboxFromEmail("hi@gmail.com")).toBe(false);
  });
});

describe("RF-13 — resendConfigProblem", () => {
  test("returns null when both values are valid", () => {
    expect(
      resendConfigProblem({
        apiKey: "re_test_abc",
        fromEmail: "Deadline Radar <hi@example.com>",
      }),
    ).toBeNull();
  });

  test("names the exact missing key problem without leaking it", () => {
    expect(resendConfigProblem({ fromEmail: "hi@example.com" })).toMatch(
      /RESEND_API_KEY/,
    );
    expect(
      resendConfigProblem({ apiKey: "re_test_abc", fromEmail: "" }),
    ).toMatch(/RESEND_FROM_EMAIL/);
  });

  test("reports malformed values with the variable name", () => {
    expect(
      resendConfigProblem({ apiKey: "nope", fromEmail: "hi@example.com" }),
    ).toMatch(/RESEND_API_KEY/);
    expect(
      resendConfigProblem({
        apiKey: "re_test_abc",
        fromEmail: "hi@nodot",
      }),
    ).toMatch(/RESEND_FROM_EMAIL/);
  });
});