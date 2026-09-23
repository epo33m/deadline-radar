/**
 * Outbound network hardening for external service calls (Finding #8).
 *
 * - `fetchWithTimeout`: every external HTTP call gets a bounded timeout via
 *   `AbortSignal.timeout`, so a hung provider can never hang a request.
 * - `withRetry`: bounded retries with exponential backoff + jitter, only for
 *   operations explicitly classified as safe by the caller. No retry happens
 *   unless `retryIf` says so, and attempts are always capped.
 *
 * Deliberately small: no circuit breaker framework, no distributed locks.
 */

export const DEFAULT_OUTBOUND_TIMEOUT_MS = 10_000;

export function fetchWithTimeout(
  url: string | URL | Request,
  init: RequestInit = {},
  timeoutMs: number = DEFAULT_OUTBOUND_TIMEOUT_MS,
): Promise<Response> {
  // Respect a caller-provided signal; otherwise bound the request lifetime.
  const signal = init.signal ?? AbortSignal.timeout(timeoutMs);
  return fetch(url, { ...init, signal });
}

export function isAbortError(error: unknown): boolean {
  return (
    error instanceof Error &&
    (error.name === "AbortError" || error.name === "TimeoutError")
  );
}

/** Thrown transport-level failures (no HTTP response was received). */
export function isTransportError(error: unknown): boolean {
  if (isAbortError(error)) return true;
  if (!(error instanceof Error)) return false;
  const message = error.message.toLowerCase();
  return (
    message.includes("fetch failed") ||
    message.includes("network") ||
    message.includes("econnreset") ||
    message.includes("econnrefused") ||
    message.includes("etimedout") ||
    message.includes("enotfound") ||
    message.includes("socket hang up")
  );
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export type RetryPolicy = {
  /** Total attempts including the first try. Defaults to 1 (no retry). */
  attempts?: number;
  /** Base backoff delay in ms before retry #1. Defaults to 500. */
  baseDelayMs?: number;
  /** Maximum backoff delay in ms. Defaults to 5000. */
  maxDelayMs?: number;
  /**
   * Decide whether `error` from attempt `attempt` (1-based) may be retried.
   * Default: thrown transport-level errors only (never error payloads).
   */
  retryIf?: (error: unknown, attempt: number) => boolean;
  /** Test hook: replace the sleep between attempts. */
  sleepFn?: (ms: number) => Promise<void>;
};

/** Equal-jitter backoff: temp = min(cap, base * 2^n); sleep temp/2 + rand(temp/2). */
export function backoffDelayMs(
  attempt: number,
  baseDelayMs: number,
  maxDelayMs: number,
  randomFn: () => number = Math.random,
): number {
  const capped = Math.min(maxDelayMs, baseDelayMs * 2 ** (attempt - 1));
  return capped / 2 + randomFn() * (capped / 2);
}

/**
 * Run `operation` with a per-attempt abort signal and bounded retries.
 * The operation receives a fresh `AbortSignal.timeout(timeoutMs)` per attempt
 * unless it already carries its own signal handling.
 */
export async function withResilience<T>(
  operation: (signal: AbortSignal) => Promise<T>,
  options: {
    timeoutMs?: number;
    attempts?: number;
    baseDelayMs?: number;
    maxDelayMs?: number;
    retryIf?: (error: unknown, attempt: number) => boolean;
    sleepFn?: (ms: number) => Promise<void>;
  } = {},
): Promise<T> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_OUTBOUND_TIMEOUT_MS;
  const attempts = Math.max(1, Math.floor(options.attempts ?? 1));
  const baseDelayMs = options.baseDelayMs ?? 500;
  const maxDelayMs = options.maxDelayMs ?? 5000;
  const retryIf = options.retryIf ?? isTransportError;
  const sleepFn = options.sleepFn ?? sleep;

  let lastError: unknown;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await operation(AbortSignal.timeout(timeoutMs));
    } catch (error) {
      lastError = error;
      if (attempt >= attempts || !retryIf(error, attempt)) {
        throw error;
      }
      await sleepFn(backoffDelayMs(attempt, baseDelayMs, maxDelayMs));
    }
  }
  throw lastError;
}
