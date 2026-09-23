import { describe, expect, test } from "bun:test";

import {
  CONFIRM_NEXT_FALLBACK,
  resolveConfirmNextPath,
  resolveSafeReturnTo,
} from "./redirect";

describe("resolveConfirmNextPath", () => {
  test("accepts legitimate internal paths", () => {
    expect(resolveConfirmNextPath("/reset-password")).toBe("/reset-password");
    expect(resolveConfirmNextPath("/summary")).toBe("/summary");
  });

  test("rejects protocol-relative URLs", () => {
    expect(resolveConfirmNextPath("//evil.com")).toBe(CONFIRM_NEXT_FALLBACK);
    expect(resolveConfirmNextPath("///evil.com")).toBe(CONFIRM_NEXT_FALLBACK);
  });

  test("rejects backslash tricks", () => {
    expect(resolveConfirmNextPath("/\\evil.com")).toBe(CONFIRM_NEXT_FALLBACK);
    expect(resolveConfirmNextPath("/\\/evil.com")).toBe(
      CONFIRM_NEXT_FALLBACK,
    );
  });

  test("rejects absolute URLs", () => {
    expect(resolveConfirmNextPath("https://evil.com")).toBe(
      CONFIRM_NEXT_FALLBACK,
    );
    expect(resolveConfirmNextPath("http://evil.com")).toBe(
      CONFIRM_NEXT_FALLBACK,
    );
    expect(resolveConfirmNextPath("https://evil.com/reset-password")).toBe(
      CONFIRM_NEXT_FALLBACK,
    );
  });

  test("rejects javascript: and data: payloads", () => {
    expect(resolveConfirmNextPath("javascript:alert(1)")).toBe(
      CONFIRM_NEXT_FALLBACK,
    );
    expect(resolveConfirmNextPath("JaVaScRiPt:alert(1)")).toBe(
      CONFIRM_NEXT_FALLBACK,
    );
    expect(resolveConfirmNextPath("data:text/html,<h1>x</h1>")).toBe(
      CONFIRM_NEXT_FALLBACK,
    );
  });

  test("rejects non-allow-listed internal paths and non-strings", () => {
    expect(resolveConfirmNextPath("/settings")).toBe(CONFIRM_NEXT_FALLBACK);
    expect(resolveConfirmNextPath("/reset-password/")).toBe(
      CONFIRM_NEXT_FALLBACK,
    );
    expect(resolveConfirmNextPath("")).toBe(CONFIRM_NEXT_FALLBACK);
    expect(resolveConfirmNextPath(undefined)).toBe(CONFIRM_NEXT_FALLBACK);
    expect(resolveConfirmNextPath(null)).toBe(CONFIRM_NEXT_FALLBACK);
  });
});

describe("resolveSafeReturnTo (SEC-001)", () => {
  const FALLBACK = "/tasks/abc";

  test("accepts legitimate internal paths incl. query strings", () => {
    expect(resolveSafeReturnTo("/tasks", FALLBACK)).toBe("/tasks");
    expect(
      resolveSafeReturnTo("/courses/550e8400-e29b-41d4-a716-446655440000", FALLBACK),
    ).toBe("/courses/550e8400-e29b-41d4-a716-446655440000");
    expect(
      resolveSafeReturnTo(
        "/courses/550e8400-e29b-41d4-a716-446655440000?view=all",
        FALLBACK,
      ),
    ).toBe("/courses/550e8400-e29b-41d4-a716-446655440000?view=all");
    expect(resolveSafeReturnTo("/summary", FALLBACK)).toBe("/summary");
  });

  test("rejects protocol-relative URLs", () => {
    expect(resolveSafeReturnTo("//evil.com", FALLBACK)).toBe(FALLBACK);
    expect(resolveSafeReturnTo("//evil.com/phish", FALLBACK)).toBe(FALLBACK);
    expect(resolveSafeReturnTo("///evil.com", FALLBACK)).toBe(FALLBACK);
  });

  test("rejects backslash tricks", () => {
    expect(resolveSafeReturnTo("/\\evil.com", FALLBACK)).toBe(FALLBACK);
    expect(resolveSafeReturnTo("/\\/evil.com", FALLBACK)).toBe(FALLBACK);
  });

  test("rejects absolute URLs and scheme payloads", () => {
    expect(resolveSafeReturnTo("https://evil.com", FALLBACK)).toBe(FALLBACK);
    expect(resolveSafeReturnTo("https://evil.com/tasks", FALLBACK)).toBe(
      FALLBACK,
    );
    expect(resolveSafeReturnTo("javascript:alert(1)", FALLBACK)).toBe(
      FALLBACK,
    );
    expect(resolveSafeReturnTo("JaVaScRiPt:alert(1)", FALLBACK)).toBe(
      FALLBACK,
    );
    expect(resolveSafeReturnTo("data:text/html,<h1>x</h1>", FALLBACK)).toBe(
      FALLBACK,
    );
  });

  test("rejects control characters and non-string input", () => {
    expect(resolveSafeReturnTo("/tasks\r\nSet-Cookie: x", FALLBACK)).toBe(
      FALLBACK,
    );
    expect(resolveSafeReturnTo("/tasks\x00", FALLBACK)).toBe(FALLBACK);
    expect(resolveSafeReturnTo("", FALLBACK)).toBe(FALLBACK);
    expect(resolveSafeReturnTo(undefined, FALLBACK)).toBe(FALLBACK);
    expect(resolveSafeReturnTo(null, FALLBACK)).toBe(FALLBACK);
  });
});

describe("resolveSafeReturnTo accepts backend-issued destinations (SEC-005)", () => {
  test("every redirectTo the API can emit passes validation", () => {
    const issued = [
      "/summary", // login, confirm fallback
      "/login", // logout, reset-password
      "/settings", // register
      "/reset-password", // confirm recovery
      "/tasks/550e8400-e29b-41d4-a716-446655440000", // task create
    ];
    for (const destination of issued) {
      expect(resolveSafeReturnTo(destination, "/summary")).toBe(destination);
    }
  });

  test("a future backend regression echoing input falls back internal", () => {
    for (const evil of [
      "//evil.com/phish",
      "https://evil.com/summary",
      "javascript:alert(1)",
    ]) {
      expect(resolveSafeReturnTo(evil, "/summary")).toBe("/summary");
      expect(resolveSafeReturnTo(evil, "")).toBe("");
    }
  });
});
