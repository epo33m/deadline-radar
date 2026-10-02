/**
 * I-04: web-to-API timeouts + cancellation.
 *
 * NOTE: server.ts pulls next/headers (no Next runtime under bun test), so
 * only the shared timeout helpers and the importable client.ts are exercised
 * here. server.ts wires the exact same helpers (review-visible, one-to-one
 * with the client path) and is covered by typecheck.
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";

import { apiBrowser } from "./client";
import { ERROR_COPY } from "@deadline-radar/validation";
import {
  API_TIMEOUT_MS,
  createApiTimeout,
  isAbortError,
  isApiTimeoutError,
  resolveApiTimeoutMs,
  timeoutErrorBody,
  ApiTimeoutError,
} from "./timeout";

const realFetch = globalThis.fetch;
let fetchCalls = 0;
let fetchImpl: (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response> = () => {
  throw new Error("fetch impl not set");
};

function hangHonoringSignal(
  _input: string | URL | Request,
  init?: RequestInit,
): Promise<Response> {
  return new Promise((_resolve, reject) => {
    const signal = init?.signal;
    if (signal?.aborted) {
      reject(signal.reason);
      return;
    }
    signal?.addEventListener("abort", () => reject(signal.reason), {
      once: true,
    });
  });
}

function okJson(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200 });
}

beforeEach(() => {
  fetchCalls = 0;
  globalThis.fetch = (async (
    input: string | URL | Request,
    init?: RequestInit,
  ) => {
    fetchCalls += 1;
    return fetchImpl(input, init);
  }) as typeof fetch;
});

afterEach(() => {
  globalThis.fetch = realFetch;
});

describe("I-04 — resolveApiTimeoutMs", () => {
  test("interactive default, upload for FormData, explicit wins", () => {
    expect(resolveApiTimeoutMs({})).toBe(API_TIMEOUT_MS.interactive);
    expect(resolveApiTimeoutMs({}, { requestClass: "background" })).toBe(
      API_TIMEOUT_MS.background,
    );
    expect(resolveApiTimeoutMs({ body: new FormData() })).toBe(
      API_TIMEOUT_MS.upload,
    );
    expect(
      resolveApiTimeoutMs({ body: new FormData() }, { timeoutMs: 50 }),
    ).toBe(50);
    expect(resolveApiTimeoutMs({}, { timeoutMs: -5 })).toBe(
      API_TIMEOUT_MS.interactive,
    );
  });

  test("timeout classification is distinct from 5xx", () => {
    const body = timeoutErrorBody();
    expect(body.error).toBe(ERROR_COPY.network.requestTimedOut.message);
    expect(body.errorTitle).toBe(ERROR_COPY.network.requestTimedOut.title);
    expect(body.errorCta).toBe("Try Again");
    expect(body.isRetryable).toBe(true);
    expect(isAbortError(new DOMException("x", "AbortError"))).toBe(true);
    expect(isAbortError(new DOMException("x", "TimeoutError"))).toBe(true);
    expect(isAbortError(new Error("boom"))).toBe(false);
    const timeout = new ApiTimeoutError();
    expect(isApiTimeoutError(timeout)).toBe(true);
    expect(timeout.code).toBe("REQUEST_TIMEOUT");
    expect(isApiTimeoutError(new Error("boom"))).toBe(false);
  });
});

describe("I-04 — createApiTimeout", () => {
  test("no caller signal: any abort is a timeout", () => {
    const { signal, didTimeout } = createApiTimeout(null, 10_000);
    expect(signal.aborted).toBe(false);
    expect(didTimeout()).toBe(true);
  });

  test("caller abort is never misclassified as timeout", async () => {
    const controller = new AbortController();
    const { didTimeout } = createApiTimeout(controller.signal, 50);
    controller.abort();
    await new Promise((resolve) => setTimeout(resolve, 60));
    expect(didTimeout()).toBe(false);
  });
});

describe("I-04 — apiBrowser timeout + cancellation", () => {
  test("hung server aborts at the configured timeout with retryable timeout body", async () => {
    fetchImpl = hangHonoringSignal;
    const body = await apiBrowser("/api/x", {}, { timeoutMs: 50 });
    expect(body.error).toBe(ERROR_COPY.network.requestTimedOut.message);
    expect(
      (body as { errorCta?: unknown }).errorCta,
    ).toBe("Try Again");
    expect((body as { isRetryable?: unknown }).isRetryable).toBe(true);
    // No auto-retry loop: exactly one fetch attempt.
    expect(fetchCalls).toBe(1);
  });

  test("caller navigation cancel rethrows instead of returning a timeout body", async () => {
    fetchImpl = hangHonoringSignal;
    const controller = new AbortController();
    const pending = apiBrowser("/api/x", { signal: controller.signal });
    controller.abort();
    let thrown: unknown;
    try {
      await pending;
    } catch (error) {
      thrown = error;
    }
    // Rethrown as-is (caller cancel), never converted to a timeout body.
    expect(thrown).toBeInstanceOf(Error);
    expect(isAbortError(thrown)).toBe(true);
    expect(isApiTimeoutError(thrown)).toBe(false);
    expect(fetchCalls).toBe(1);
  });

  test("successful requests are unaffected", async () => {
    fetchImpl = async () => okJson({ hello: "world" });
    const body = await apiBrowser<{ hello?: string }>("/api/x");
    expect(body.hello).toBe("world");
    expect(body.error).toBeUndefined();
    expect(fetchCalls).toBe(1);
  });
});
