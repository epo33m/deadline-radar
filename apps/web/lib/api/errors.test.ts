import { describe, expect, it } from "bun:test";

import {
  copyForHttpStatus,
  isStatusRetryable,
  normalizeApiErrorBody,
} from "./errors";

describe("Web API Error Normalization & Copy Mapping", () => {
  it("maps standard HTTP statuses to calm, human Apple-ish copy", () => {
    expect(copyForHttpStatus(400).message).toBe(
      "We couldn't complete this request. Please check your information and try again.",
    );
    expect(copyForHttpStatus(401).title).toBe("Your session has expired");
    expect(copyForHttpStatus(403).title).toBe("Access denied");
    expect(copyForHttpStatus(404).title).toBe("Not found");
    expect(copyForHttpStatus(409).title).toBe("This has changed");
    expect(copyForHttpStatus(422).title).toBe("Check your information");
    expect(copyForHttpStatus(429).title).toBe("Too many requests");
    expect(copyForHttpStatus(500).title).toBe("Something went wrong");
    expect(copyForHttpStatus(503).title).toBe("Service unavailable");
  });

  it("correctly identifies retryable vs non-retryable statuses", () => {
    expect(isStatusRetryable(429)).toBe(true);
    expect(isStatusRetryable(502)).toBe(true);
    expect(isStatusRetryable(503)).toBe(true);
    expect(isStatusRetryable(504)).toBe(true);

    expect(isStatusRetryable(400)).toBe(false);
    expect(isStatusRetryable(401)).toBe(false);
    expect(isStatusRetryable(403)).toBe(false);
    expect(isStatusRetryable(404)).toBe(false);
    expect(isStatusRetryable(422)).toBe(false);
  });

  it("normalizes structured API error envelope and adds title and CTA", () => {
    const raw = {
      error: {
        code: "RATE_LIMITED",
        message: "Please wait a moment before trying again.",
        details: [],
      },
      requestId: "req-123",
    };

    const normalized = normalizeApiErrorBody(raw, 429);
    expect(normalized.error).toBe("Please wait a moment before trying again.");
    expect(normalized.errorTitle).toBe("Too many requests");
    expect(normalized.errorCta).toBe("Try Again");
    expect(normalized.isRetryable).toBe(true);
    expect(normalized.requestId).toBe("req-123");
  });

  it("normalizes fallback when body has no error message but status >= 400", () => {
    const raw = {};
    const normalized = normalizeApiErrorBody(raw, 503);
    expect(normalized.error).toBe(
      "We're having trouble processing your request right now. Please try again in a moment.",
    );
    expect(normalized.errorTitle).toBe("Service unavailable");
    expect(normalized.isRetryable).toBe(true);
  });
});
