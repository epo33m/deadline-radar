/**
 * Single source for the Elysia API origin used by the Next.js web process.
 *
 * Every server-side caller (`lib/api/server.ts`, `proxy.ts`, auth bridge
 * routes) and the `next.config.ts` rewrites previously inlined
 * `process.env.API_ORIGIN ?? "http://127.0.0.1:4025"` independently. A silent
 * localhost fallback in production (Vercel `ENV-WEB` missing) then fails as a
 * generic data-load error — e.g. Calendar rendering
 * "Ensure the API is running" for what is actually a misconfiguration.
 *
 * This helper keeps the same fallback (local dev must keep working with no
 * env) but makes the production fallback observable: counts-only warning, no
 * PII, no secret values, wired to the same console pipeline as the calendar
 * page-cap warn.
 */

export const LOCAL_API_ORIGIN = "http://127.0.0.1:4025";

const warned = new Set<string>();

function warnOnce(key: string, message: string): void {
  if (warned.has(key)) return;
  warned.add(key);
  console.warn(message);
}

/** Test-only reset for the once-per-process production warning. */
export function resetApiOriginWarningsForTests(): void {
  warned.clear();
}

export function isProductionEnv(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.NODE_ENV === "production" || env.VERCEL === "1";
}

export function isLocalApiOrigin(origin: string): boolean {
  return (
    origin.includes("127.0.0.1") ||
    origin.includes("localhost") ||
    origin.startsWith("http://192.168.") ||
    origin.startsWith("http://10.")
  );
}

/**
 * Resolve the API origin. Never throws: local dev without env keeps working.
 * In production, a missing or loopback value emits one warning so a missing
 * `API_ORIGIN` in Vercel `ENV-WEB` cannot silently pose as an API outage.
 */
export function resolveApiOrigin(env: NodeJS.ProcessEnv = process.env): string {
  const raw = env.API_ORIGIN?.trim();
  const origin = raw && raw.length > 0 ? raw : LOCAL_API_ORIGIN;
  if (
    isProductionEnv(env) &&
    (!raw || raw.length === 0 || isLocalApiOrigin(origin))
  ) {
    warnOnce(
      "api-origin-fallback",
      "[api-origin] API_ORIGIN is missing or loopback in production; " +
        "falling back to localhost will fail on hosted runtimes. " +
        "Set API_ORIGIN in ENV-WEB to the public API origin.",
    );
  }
  return origin;
}
