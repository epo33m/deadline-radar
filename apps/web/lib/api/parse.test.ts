/**
 * #140: a non-JSON upstream body must degrade to a controlled error, never a
 * raw SyntaxError.
 *
 * The regression this pins: a Railway/Supabase deploy window answers with an
 * HTML 502 page. `JSON.parse` threw, the server action rejected into
 * `app/(app)/error.tsx` instead of rendering the inline error, and the loaders
 * caught it as a transport failure and reported "ensure the API is running".
 */
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { ERROR_COPY } from "@deadline-radar/validation";

import { normalizeApiErrorBody } from "./errors";
import {
  apiResponseBody,
  resetApiParseWarningsForTests,
} from "./parse";

const HTML_502 = "<html><head><title>502 Bad Gateway</title></head></html>";

// A deliberate spy, not a workaround: the warn-once-per-(status, content-type)
// contract is behaviour worth pinning, and #140 makes it observable only through
// `console.warn`. (The suite runs with `bun test --isolate` — #155 — so owning
// `console.warn` here is safe and no longer load-bearing for survival.)
const realWarn = console.warn;
let warnings: unknown[][] = [];

beforeEach(() => {
  resetApiParseWarningsForTests();
  warnings = [];
  console.warn = (...args: unknown[]) => {
    warnings.push(args);
  };
});

afterEach(() => {
  console.warn = realWarn;
});

describe("#140 — apiResponseBody", () => {
  it("passes valid JSON bodies through untouched", () => {
    expect(apiResponseBody('{"tasks":[]}', 200)).toEqual({ tasks: [] });
    // Arrays are objects, so they pass through as-is; the API never returns one
    // as a body, and downstream spreads treat it as an empty record.
    expect(Array.isArray(apiResponseBody("[1,2]", 200))).toBe(true);
    expect(warnings.length).toBe(0);
  });

  it("keeps the empty-body behaviour unchanged", () => {
    expect(apiResponseBody("", 204)).toEqual({});
    expect(apiResponseBody("   \n ", 200)).toEqual({});
    expect(warnings.length).toBe(0);
  });

  it("degrades a non-JSON error response to {} so the status still classifies", () => {
    // The point of returning {} here: the real status survives, so the
    // normalizer keeps its authority over the copy (a literal "Upstream error"
    // would report "session expired"-style failures as generic).
    expect(apiResponseBody(HTML_502, 502, "text/html")).toEqual({});

    const body = normalizeApiErrorBody(apiResponseBody(HTML_502, 502, "text/html"), 502);
    expect(body.error).toBe(ERROR_COPY.server.serviceUnavailable.message);
    expect(body.errorTitle).toBe(ERROR_COPY.server.serviceUnavailable.title);
    expect(body.errorCta).toBe(ERROR_COPY.server.serviceUnavailable.cta);
    expect(body.isRetryable).toBe(true);
  });

  it("classifies a non-JSON 401 as a session expiry, not a generic failure", () => {
    const body = normalizeApiErrorBody(
      apiResponseBody(HTML_502, 401, "text/html"),
      401,
    );
    expect(body.errorTitle).toBe(ERROR_COPY.auth.sessionExpired.title);
  });

  it("never reports a false success on an unparseable 2xx", () => {
    // Returning {} for a 200 would leave `result.error` undefined, so the task
    // forms and auth forms would claim success while nothing was saved.
    const body = apiResponseBody(HTML_502, 200, "text/html");
    expect(body.error).toBe(ERROR_COPY.server.serverError.message);
    expect(body.isRetryable).toBe(true);

    const normalized = normalizeApiErrorBody(body, 200);
    expect(normalized.error).toBe(ERROR_COPY.server.serverError.message);
    expect(normalized.isRetryable).toBe(true);
  });

  it("survives a truncated body", () => {
    expect(apiResponseBody('{"tasks":[{"id"', 502, "application/json")).toEqual({});
  });

  it("treats a JSON scalar as unusable instead of crashing the normalizer", () => {
    // `JSON.parse("null")` used to reach `normalizeApiErrorBody(null, ...)`,
    // which threw a TypeError on `data.error`.
    expect(apiResponseBody("null", 200)).toEqual({
      error: ERROR_COPY.server.serverError.message,
      isRetryable: true,
    });
    expect(apiResponseBody("null", 502)).toEqual({});
    expect(() => normalizeApiErrorBody(apiResponseBody("null", 200), 200)).not.toThrow();
  });

  it("warns once per status and content-type, without echoing the body", () => {
    apiResponseBody(HTML_502, 502, "text/html");
    apiResponseBody("<html>other deploy page</html>", 502, "text/html");
    expect(warnings.length).toBe(1);
    expect(warnings[0][0]).toBe("[api] non-JSON upstream response");

    // A corrupt JSON body is a different incident than a proxy page.
    apiResponseBody('{"broken":', 502, "application/json");
    expect(warnings.length).toBe(2);
    expect(warnings[1][1]).toBe(
      JSON.stringify({ status: 502, contentType: "application/json" }),
    );

    resetApiParseWarningsForTests();
    apiResponseBody(HTML_502, 502, "text/html");
    expect(warnings.length).toBe(3);
  });
});
