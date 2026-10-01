import { describe, expect, it } from "bun:test";

import {
  CTA_VOCABULARY,
  ERROR_COPY,
  TOAST_COPY,
  formatReferenceId,
  resolveErrorCopy,
} from "./error-copy";

describe("Error Handling Copy System", () => {
  it("defines canonical CTAs adhering to the allowed vocabulary", () => {
    expect(CTA_VOCABULARY).toContain("Try Again");
    expect(CTA_VOCABULARY).toContain("Sign In");
    expect(CTA_VOCABULARY).toContain("Refresh");
    expect(CTA_VOCABULARY).toContain("Go Back");
    expect(CTA_VOCABULARY).toContain("Done");
  });

  it("contains calm and respectful copy across general and auth categories", () => {
    expect(ERROR_COPY.general.somethingWentWrong.title).toBe("Something went wrong");
    expect(ERROR_COPY.general.somethingWentWrong.message).toBe(
      "We couldn't complete this action. Please try again.",
    );
    expect(ERROR_COPY.general.somethingWentWrong.cta).toBe("Try Again");

    expect(ERROR_COPY.auth.sessionExpired.title).toBe("Your session has expired");
    expect(ERROR_COPY.auth.sessionExpired.message).toBe("Sign in again to continue.");
    expect(ERROR_COPY.auth.sessionExpired.cta).toBe("Sign In");
  });

  it("formats validation messages correctly", () => {
    expect(ERROR_COPY.validation.requiredField).toBe("This field is required.");
    expect(ERROR_COPY.validation.tooFewCharacters(8)).toBe("Enter at least 8 characters.");
  });

  it("formats reference ID without leaking internal structures", () => {
    expect(formatReferenceId("abc-123")).toBe("REF-ABC-123");
    expect(formatReferenceId("REF-998877")).toBe("REF-998877");
    const autoGen = formatReferenceId();
    expect(autoGen.startsWith("REF-")).toBe(true);
    expect(autoGen.length).toBeGreaterThan(5);
  });

  it("resolves error copy from API error codes", () => {
    const unauth = resolveErrorCopy("UNAUTHORIZED");
    expect(unauth.title).toBe("Your session has expired");
    expect(unauth.cta).toBe("Sign In");

    const rateLimit = resolveErrorCopy("RATE_LIMITED");
    expect(rateLimit.title).toBe("Too many requests");

    const fallback = resolveErrorCopy("UNKNOWN_CODE");
    expect(fallback.title).toBe("Something went wrong");
  });

  it("provides toast copy library for lightweight feedback", () => {
    expect(TOAST_COPY.save).toBe("Changes saved.");
    expect(TOAST_COPY.delete).toBe("Item deleted.");
    expect(TOAST_COPY.copy).toBe("Copied to clipboard.");
    expect(TOAST_COPY.failed).toBe("Couldn't complete that action.");
  });
});
