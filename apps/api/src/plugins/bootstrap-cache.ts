import { Elysia } from "elysia";

import {
  invalidateBootstrapCache,
  isBootstrapInvalidating,
} from "../lib/bootstrap-cache";

/**
 * Bootstrap cache eviction (perf plan, Fase F).
 *
 * Single hook instead of per-route calls: any successful authenticated
 * mutation (POST/PATCH/PUT/DELETE, 2xx) evicts the actor's bootstrap entry.
 * Future mutating routes are covered automatically; over-eviction (e.g.
 * notification reads, which bootstrap does not carry) only costs a
 * refetch. Read-only and anonymous requests never evict.
 */
export const bootstrapCachePlugin = new Elysia({
  name: "bootstrap-cache",
}).onAfterHandle({ as: "global" }, ({ request, set, ...context }) => {
  const user = (context as { user?: { id?: unknown } | null }).user;
  const userId = typeof user?.id === "string" ? user.id : null;
  // onAfterHandle only runs on the success path, so an unset status is a
  // 2xx by construction — default it instead of skipping eviction.
  const status = typeof set.status === "number" ? set.status : 200;
  if (userId && isBootstrapInvalidating(request.method, status, userId)) {
    invalidateBootstrapCache(userId);
  }
});
