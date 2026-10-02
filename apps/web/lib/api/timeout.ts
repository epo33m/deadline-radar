/**
 * I-04: bounded timeouts + cancellation for web-to-API requests.
 *
 * `apiFetch` (server) and `apiBrowser` (client) previously set no timeout or
 * signal, so a stalled API hung pages indefinitely. Every request now gets a
 * bounded lifetime by default; an explicit caller signal (navigation/unmount)
 * still wins and is never masked as a timeout.
 *
 * Request classes keep the policy explicit: interactive pages get a tight
 * bound, multipart uploads (10 MiB allowlisted) get a longer one so
 * legitimate uploads are never cut off, background work sits in between.
 * An explicit `timeoutMs` always wins (including in tests).
 */
import { ERROR_COPY } from "@deadline-radar/validation";

import type { ApiErrorBody } from "@/lib/api/errors";

export type ApiRequestClass = "interactive" | "upload" | "background";

export const API_TIMEOUT_MS: Record<ApiRequestClass, number> = {
  interactive: 30_000,
  upload: 120_000,
  background: 60_000,
};

export type ApiTimeoutOptions = {
  /** Explicit bound in ms. Wins over request class and FormData detection. */
  timeoutMs?: number;
  /** Policy class. Defaults to "upload" for FormData bodies, else "interactive". */
  requestClass?: ApiRequestClass;
  /** Caller-owned signal (navigation/unmount). Combined with the timeout. */
  signal?: AbortSignal;
};

export function resolveApiTimeoutMs(
  init: RequestInit = {},
  options: ApiTimeoutOptions = {},
): number {
  if (
    options.timeoutMs !== undefined &&
    Number.isFinite(options.timeoutMs) &&
    options.timeoutMs > 0
  ) {
    return options.timeoutMs;
  }
  if (options.requestClass) return API_TIMEOUT_MS[options.requestClass];
  if (init.body instanceof FormData) return API_TIMEOUT_MS.upload;
  return API_TIMEOUT_MS.interactive;
}

export function isAbortError(error: unknown): boolean {
  return (
    error instanceof Error &&
    (error.name === "AbortError" || error.name === "TimeoutError")
  );
}

/**
 * Combine a caller signal with a timeout bound. The returned `didTimeout`
 * reports whether the timeout fired WITHOUT a prior caller abort — a user
 * navigation cancel is never misclassified as a timeout.
 */
export function createApiTimeout(
  callerSignal?: AbortSignal | null,
  timeoutMs?: number,
): { signal: AbortSignal; didTimeout: () => boolean } {
  const ms =
    timeoutMs !== undefined &&
    Number.isFinite(timeoutMs) &&
    timeoutMs > 0
      ? timeoutMs
      : API_TIMEOUT_MS.interactive;
  if (!callerSignal) {
    return { signal: AbortSignal.timeout(ms), didTimeout: () => true };
  }
  const timeoutSignal = AbortSignal.timeout(ms);
  let timeoutFired = false;
  timeoutSignal.addEventListener(
    "abort",
    () => {
      timeoutFired = true;
    },
    { once: true },
  );
  return {
    signal: AbortSignal.any([callerSignal, timeoutSignal]),
    didTimeout: () => timeoutFired && !callerSignal.aborted,
  };
}

/** Application error body for timeouts — distinct from 5xx classification. */
export function timeoutErrorBody(): ApiErrorBody {
  const copy = ERROR_COPY.network.requestTimedOut;
  return {
    error: copy.message,
    errorTitle: copy.title,
    errorCta: copy.cta,
    isRetryable: true,
  };
}

/** Thrown by server-side `apiFetch` when its own timeout fires. */
export class ApiTimeoutError extends Error {
  readonly code = "REQUEST_TIMEOUT";
  readonly body: ApiErrorBody;

  constructor(body: ApiErrorBody = timeoutErrorBody()) {
    super(body.error ?? "Request timed out");
    this.name = "ApiTimeoutError";
    this.body = body;
  }
}

export function isApiTimeoutError(error: unknown): error is ApiTimeoutError {
  return error instanceof ApiTimeoutError;
}
