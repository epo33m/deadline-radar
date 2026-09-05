import { Elysia } from "elysia";

type Bucket = { count: number; resetAt: number };

const buckets = new Map<string, Bucket>();

function clientKey(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0]?.trim() || "unknown";
  return request.headers.get("x-real-ip") ?? "local";
}

function limitForPath(pathname: string): { max: number; windowMs: number } {
  if (
    pathname === "/api/auth/login" ||
    pathname === "/api/auth/register" ||
    pathname === "/api/auth/forgot-password" ||
    pathname === "/api/auth/reset-password"
  ) {
    return { max: 20, windowMs: 60_000 };
  }
  if (pathname.startsWith("/api/auth")) {
    return { max: 60, windowMs: 60_000 };
  }
  if (pathname.startsWith("/api/cron")) {
    return { max: 10, windowMs: 60_000 };
  }
  return { max: 180, windowMs: 60_000 };
}

/**
 * In-memory rate limit (per process). Fine for local/single-node;
 * swap for Redis when scaling horizontally.
 */
export const rateLimitPlugin = new Elysia({ name: "rate-limit" }).onBeforeHandle(
  { as: "global" },
  ({ request, set }) => {
    const pathname = new URL(request.url).pathname;
    if (pathname === "/health" || pathname.startsWith("/openapi")) return;

    const { max, windowMs } = limitForPath(pathname);
    const scope = pathname.startsWith("/api/auth")
      ? pathname.startsWith("/api/auth/login") ||
        pathname.startsWith("/api/auth/register") ||
        pathname.startsWith("/api/auth/forgot") ||
        pathname.startsWith("/api/auth/reset")
        ? "auth-sensitive"
        : "auth"
      : pathname.startsWith("/api/cron")
        ? "cron"
        : "api";
    const key = `${clientKey(request)}:${scope}`;
    const now = Date.now();
    let bucket = buckets.get(key);
    if (!bucket || bucket.resetAt <= now) {
      bucket = { count: 0, resetAt: now + windowMs };
      buckets.set(key, bucket);
    }
    bucket.count += 1;

    const remaining = Math.max(0, max - bucket.count);
    set.headers["X-RateLimit-Limit"] = String(max);
    set.headers["X-RateLimit-Remaining"] = String(remaining);
    set.headers["X-RateLimit-Reset"] = String(Math.ceil(bucket.resetAt / 1000));

    if (bucket.count > max) {
      set.status = 429;
      return {
        error: "Too many requests. Slow down and try again.",
      };
    }
  },
);

/** Test helper */
export function resetRateLimitBuckets(): void {
  buckets.clear();
}
