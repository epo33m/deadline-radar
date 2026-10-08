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

/*
 * `console.warn` must be owned by this file. `proxy.test.ts` imports
 * `next/experimental/testing/server`, which replaces `console.*` with Next's
 * console — outside a request scope every call throws
 * "Invariant: AsyncLocalStorage accessed in runtime where it is not available",
 * so a real `console.warn` from application code fails whichever test happens
 * to run after it. `apiResponseBody` legitimately warns, so stub it here; the
 * warning itself is pinned in `parse.test.ts`.
 */
const realWarn = console.warn;

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
  console.warn = () => undefined;
  globalThis.fetch = (async () => {
    if (!response) throw new Error("fetch response not set");
    return response;
  }) as unknown as typeof fetch;
});

afterEach(() => {
  globalThis.fetch = realFetch;
  console.warn = realWarn;
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
