/**
 * Progressive delay / failed-attempt tracking for credential abuse mitigation.
 * In-memory (single-node). Document Redis swap for multi-instance production.
 *
 * Two independent scopes (Finding #9):
 * - IP-scoped (`email:ip`): progressive delay against single-source guessing.
 * - Account-scoped (`email` only): survives client-IP rotation. Keyed by the
 *   normalized email string for existing AND nonexistent addresses alike, so
 *   the throttle itself reveals nothing about account existence.
 */

import { resolveClientIp } from "./proxy-trust";
import { getRedis, withRedisTimeout } from "./redis";

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

/**
 * Account-level throttle: same windows as the IP scope, but keyed by email
 * alone so rotating the client IP does not reset the budget. Higher
 * threshold (10 vs 3) to avoid punishing legitimate users behind NAT.
 */
const ACCOUNT_WINDOW_MS = 15 * 60_000;
const MAX_ACCOUNT_FAILURES_BEFORE_DELAY = 10;

const accountAttempts = new Map<string, AttemptBucket>();

export function accountAttemptKey(email: string): string {
  return `acct:${normalizeEmail(email)}`;
}

let redisOverride: Awaited<ReturnType<typeof getRedis>> | undefined;

export function setAbuseRedisForTests(
  redis: Awaited<ReturnType<typeof getRedis>> | undefined,
): void {
  redisOverride = redis;
}

async function resolveRedis() {
  if (redisOverride !== undefined) return redisOverride;
  return getRedis();
}

type AbuseRedisClient = NonNullable<Awaited<ReturnType<typeof getRedis>>>;

type RedisOutcome<T> = { ok: true; value: T } | { ok: false };

function redisFailure(label: string, error: unknown): void {
  console.warn(
    `[redis] auth-abuse ${label} failed, using memory bucket`,
    error instanceof Error ? error.message : "unknown",
  );
}

/**
 * Bounded, throw-free wrapper for the throttle's authoritative Redis ops
 * (lock read, failure counter, clear). A timeout or error degrades that
 * call to the in-memory bucket instead of hanging or 500ing the login —
 * same posture as `rate-limit.ts`. The value is boxed so a legitimate
 * `null` (missing key) is never confused with a timeout.
 */
async function guardedRedis<T>(
  label: string,
  op: (redis: AbuseRedisClient) => Promise<T>,
): Promise<RedisOutcome<T>> {
  const redis = await resolveRedis();
  if (!redis) return { ok: false };
  try {
    const outcome = await withRedisTimeout(op(redis).then((value) => ({ value })));
    if (outcome === null) {
      console.warn(`[redis] auth-abuse ${label} timeout, using memory bucket`);
      return { ok: false };
    }
    return { ok: true, value: outcome.value };
  } catch (error) {
    redisFailure(label, error);
    return { ok: false };
  }
}

/** Best-effort Redis op (TTL, lock write): a failure only warns. */
async function bestEffortRedis(
  label: string,
  op: () => Promise<unknown>,
): Promise<void> {
  try {
    const value = await withRedisTimeout(op());
    if (value === null) {
      console.warn(`[redis] auth-abuse ${label} timeout, continuing`);
    }
  } catch (error) {
    console.warn(
      `[redis] auth-abuse ${label} failed, continuing`,
      error instanceof Error ? error.message : "unknown",
    );
  }
}

function getAccountBucket(key: string, now: number): AttemptBucket {
  let bucket = accountAttempts.get(key);
  if (!bucket || bucket.windowResetAt <= now) {
    bucket = {
      failures: 0,
      windowResetAt: now + ACCOUNT_WINDOW_MS,
      lockedUntil: 0,
    };
    accountAttempts.set(key, bucket);
  }
  return bucket;
}

/** Delay ms the account must wait before another attempt, or 0. */
export async function getAccountDelayMs(
  key: string,
  now = Date.now(),
): Promise<number> {
  const result = await guardedRedis("get account lock", (redis) =>
    redis.get(`auth:lock:acct:${key}`),
  );
  if (result.ok) {
    const raw = result.value;
    if (raw) {
      const lockedUntil = Number(raw);
      if (Number.isFinite(lockedUntil)) {
        return Math.max(0, lockedUntil - now);
      }
    }
    return 0;
  }

  const bucket = accountAttempts.get(key);
  if (!bucket) return 0;
  if (bucket.windowResetAt <= now) {
    accountAttempts.delete(key);
    return 0;
  }
  return Math.max(0, bucket.lockedUntil - now);
}

export async function recordAccountFailure(
  key: string,
  now = Date.now(),
): Promise<number> {
  const failKey = `auth:fail:acct:${key}`;
  const result = await guardedRedis("incr account failures", async (redis) => {
    const count = await redis.incr(failKey);
    if (count === 1) {
      await bestEffortRedis("pexpire account failures", () =>
        redis.pexpire(failKey, ACCOUNT_WINDOW_MS),
      );
    }
    if (count >= MAX_ACCOUNT_FAILURES_BEFORE_DELAY) {
      const over = count - MAX_ACCOUNT_FAILURES_BEFORE_DELAY + 1;
      const delay = Math.min(MAX_DELAY_MS, BASE_DELAY_MS * 2 ** (over - 1));
      await bestEffortRedis("set account lock", () =>
        redis.set(`auth:lock:acct:${key}`, String(now + delay), { px: delay }),
      );
      return delay;
    }
    return 0;
  });
  if (result.ok) return result.value;

  const bucket = getAccountBucket(key, now);
  bucket.failures += 1;
  if (bucket.failures >= MAX_ACCOUNT_FAILURES_BEFORE_DELAY) {
    const over = bucket.failures - MAX_ACCOUNT_FAILURES_BEFORE_DELAY + 1;
    const delay = Math.min(MAX_DELAY_MS, BASE_DELAY_MS * 2 ** (over - 1));
    bucket.lockedUntil = now + delay;
    return delay;
  }
  bucket.lockedUntil = 0;
  return 0;
}

export async function clearAccountFailures(key: string): Promise<void> {
  accountAttempts.delete(key);
  await guardedRedis("clear account failures", async (redis) => {
    await redis.del(`auth:fail:acct:${key}`);
    await redis.del(`auth:lock:acct:${key}`);
  });
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
export async function getLoginDelayMs(
  key: string,
  now = Date.now(),
): Promise<number> {
  const result = await guardedRedis("get login lock", (redis) =>
    redis.get(`auth:lock:login:${key}`),
  );
  if (result.ok) {
    const raw = result.value;
    if (raw) {
      const lockedUntil = Number(raw);
      if (Number.isFinite(lockedUntil)) {
        return Math.max(0, lockedUntil - now);
      }
    }
    return 0;
  }

  const bucket = loginAttempts.get(key);
  if (!bucket) return 0;
  if (bucket.windowResetAt <= now) {
    loginAttempts.delete(key);
    return 0;
  }
  return Math.max(0, bucket.lockedUntil - now);
}

export async function recordLoginFailure(
  key: string,
  now = Date.now(),
): Promise<number> {
  const failKey = `auth:fail:login:${key}`;
  const result = await guardedRedis("incr login failures", async (redis) => {
    const count = await redis.incr(failKey);
    if (count === 1) {
      await bestEffortRedis("pexpire login failures", () =>
        redis.pexpire(failKey, WINDOW_MS),
      );
    }
    if (count >= MAX_FAILURES_BEFORE_DELAY) {
      const over = count - MAX_FAILURES_BEFORE_DELAY + 1;
      const delay = Math.min(MAX_DELAY_MS, BASE_DELAY_MS * 2 ** (over - 1));
      await bestEffortRedis("set login lock", () =>
        redis.set(`auth:lock:login:${key}`, String(now + delay), { px: delay }),
      );
      return delay;
    }
    return 0;
  });
  if (result.ok) return result.value;

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

export async function clearLoginFailures(key: string): Promise<void> {
  loginAttempts.delete(key);
  await guardedRedis("clear login failures", async (redis) => {
    await redis.del(`auth:fail:login:${key}`);
    await redis.del(`auth:lock:login:${key}`);
  });
}

/** Test helper — clears all in-memory buckets. */
export function resetLoginAttemptStore(): void {
  loginAttempts.clear();
}

/** Test helper — clears all in-memory account buckets. */
export function resetAccountAttemptStore(): void {
  accountAttempts.clear();
}

export function clientIpFromRequest(
  request: Request,
  peerAddress: string | null = null,
): string {
  return resolveClientIp(request, peerAddress);
}
