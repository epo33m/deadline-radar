/**
 * #140 regression on the real browser path: `apiBrowser` must return a
 * controlled error body when the upstream answers with a non-JSON response
 * (deploy-window HTML page), instead of throwing a raw SyntaxError that leaves
 * the auth form with no result at all.
 */
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { ERROR_COPY } from "@deadline-radar/validation";

import { apiBrowser } from "./client";

const HTML_502 = "<html><head><title>502 Bad Gateway</title></head></html>";

// No console stub, deliberately: `apiResponseBody` warns on a non-JSON body,
// so this file exercises the real `console.warn` on every run. That is only safe
// because the suite runs with `bun test --isolate` (#155) — before it, one
// file's `next/experimental/testing/server` import poisoned the shared console
// and this test failed for reasons that had nothing to do with #140.

const realFetch = globalThis.fetch;
let response: Response | null = null;

function htmlResponse(body: string, status: number): Response {
  return new Response(body, {
    status,
    headers: { "content-type": "text/html" },
  });
}

beforeEach(() => {
  response = null;
  globalThis.fetch = (async () => {
    if (!response) throw new Error("fetch response not set");
    return response;
  }) as unknown as typeof fetch;
});

afterEach(() => {
  globalThis.fetch = realFetch;
});

describe("#140 — apiBrowser with a non-JSON upstream response", () => {
  it("returns the controlled 502 error shape instead of throwing", async () => {
    response = htmlResponse(HTML_502, 502);

    const body = await apiBrowser("/api/auth/login");

    expect(body.error).toBe(ERROR_COPY.server.serviceUnavailable.message);
    // `errorTitle` / `errorCta` / `isRetryable` are provided by
    // `normalizeApiErrorBody` but absent from `apiBrowser`'s declared return
    // type — cast like `timeout.test.ts` does for the timeout body.
    const normalized = body as {
      errorTitle?: string;
      errorCta?: unknown;
      isRetryable?: boolean;
    };
    expect(normalized.errorTitle).toBe(
      ERROR_COPY.server.serviceUnavailable.title,
    );
    expect(normalized.errorCta).toBe(ERROR_COPY.server.serviceUnavailable.cta);
    expect(normalized.isRetryable).toBe(true);
  });

  it("does not report success on an unparseable 200", async () => {
    response = htmlResponse(HTML_502, 200);

    const body = await apiBrowser("/api/auth/login");

    expect(body.error).toBe(ERROR_COPY.server.serverError.message);
    expect((body as { isRetryable?: boolean }).isRetryable).toBe(true);
  });

  it("leaves valid JSON responses unchanged", async () => {
    response = new Response(JSON.stringify({ accessToken: "a-token" }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });

    const body = await apiBrowser<{ accessToken?: string }>("/api/auth/login");

    expect(body.accessToken).toBe("a-token");
    expect(body.error).toBeUndefined();
  });
});
