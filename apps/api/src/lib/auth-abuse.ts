/**
 * Progressive delay / failed-attempt tracking for credential abuse mitigation.
 * In-memory (single-node). Document Redis swap for multi-instance production.
 */

type AttemptBucket = {
  failures: number;
  windowResetAt: number;
  lockedUntil: number;
};

const loginAttempts = new Map<string, AttemptBucket>();

const WINDOW_MS = 15 * 60_000;
const MAX_FAILURES_BEFORE_DELAY = 3;
const BASE_DELAY_MS = 500;
const MAX_DELAY_MS = 30_000;

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function loginAttemptKey(email: string, ip: string): string {
  return `${normalizeEmail(email)}:${ip}`;
}

function getBucket(key: string, now: number): AttemptBucket {
  let bucket = loginAttempts.get(key);
  if (!bucket || bucket.windowResetAt <= now) {
    bucket = {
      failures: 0,
      windowResetAt: now + WINDOW_MS,
      lockedUntil: 0,
    };
    loginAttempts.set(key, bucket);
  }
  return bucket;
}

/** Returns delay ms that must elapse before another attempt, or 0. */
export function getLoginDelayMs(key: string, now = Date.now()): number {
  const bucket = loginAttempts.get(key);
  if (!bucket) return 0;
  if (bucket.windowResetAt <= now) {
    loginAttempts.delete(key);
    return 0;
  }
  return Math.max(0, bucket.lockedUntil - now);
}

export function recordLoginFailure(key: string, now = Date.now()): number {
  const bucket = getBucket(key, now);
  bucket.failures += 1;
  if (bucket.failures >= MAX_FAILURES_BEFORE_DELAY) {
    const over = bucket.failures - MAX_FAILURES_BEFORE_DELAY + 1;
    const delay = Math.min(MAX_DELAY_MS, BASE_DELAY_MS * 2 ** (over - 1));
    bucket.lockedUntil = now + delay;
    return delay;
  }
  bucket.lockedUntil = 0;
  return 0;
}

export function clearLoginFailures(key: string): void {
  loginAttempts.delete(key);
}

/** Test helper — clears all in-memory buckets. */
export function resetLoginAttemptStore(): void {
  loginAttempts.clear();
}

export function clientIpFromRequest(request: Request): string {
  if (process.env.TRUST_PROXY === "true") {
    const forwarded = request.headers.get("x-forwarded-for");
    if (forwarded) return forwarded.split(",")[0]?.trim() || "unknown";
    return request.headers.get("x-real-ip") ?? "local";
  }
  return "local";
}
