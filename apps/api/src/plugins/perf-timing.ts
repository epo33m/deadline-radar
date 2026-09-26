import { Elysia } from "elysia";

const starts = new WeakMap<Request, number>();

/**
 * Per-request server-side timing (Phase A of the perf plan).
 *
 * Emits one `[perf]` line per request: method, path, status, wall ms.
 * Log-only: it never mutates the response, so it cannot change envelopes,
 * headers, or status codes asserted by the route suites.
 *
 * Register FIRST in app.ts so the wall time brackets every other plugin and
 * handler (rate limit, auth, DB).
 */
export const perfTimingPlugin = new Elysia({ name: "perf-timing" })
  .onRequest(({ request }) => {
    starts.set(request, performance.now());
  })
  .onAfterResponse({ as: "global" }, ({ request, set }) => {
    const start = starts.get(request);
    if (start === undefined) return;
    starts.delete(request);
    const pathname = new URL(request.url).pathname;
    const status = typeof set.status === "number" ? set.status : 200;
    const totalMs = Math.max(0, Math.round(performance.now() - start));
    console.log(`[perf] ${request.method} ${pathname} ${status} ${totalMs}ms`);
  });
