import { Elysia } from "elysia";

import {
  ACCESS_COOKIE,
  verifyAccessToken,
  type AuthUser,
} from "../lib/auth-tokens";
import { AUTH_ERRORS } from "../lib/auth-errors";
import {
  loadAuthorizationContext,
  requireCapability,
  unauthorizedResponse,
  type AuthorizationContext,
  type Capability,
} from "../lib/authorization";
import { ApiError } from "../lib/api/errors";
import {
  extractClientRequestId,
  normalizeRequestId,
  requestIdPlugin,
} from "../lib/api/request-id";

/**
 * Authentication + authorization derive.
 * Identity from JWT/cookie; roles/capabilities from DB (never from the client).
 */
export const authPlugin = new Elysia({ name: "auth" })
  .use(requestIdPlugin)
  .derive(
  { as: "scoped" },
  async ({ cookie, request, requestId }) => {
    const header = request.headers.get("authorization");
    const bearer =
      header?.startsWith("Bearer ") ? header.slice("Bearer ".length) : null;
    const token =
      bearer ??
      (typeof cookie[ACCESS_COOKIE]?.value === "string"
        ? cookie[ACCESS_COOKIE].value
        : null);

    const user: AuthUser | null = token
      ? await verifyAccessToken(token)
      : null;

    const rid =
      (typeof requestId === "string" && requestId) ||
      normalizeRequestId(extractClientRequestId(request));

    const authz: AuthorizationContext | null = user
      ? await loadAuthorizationContext(user, rid)
      : null;

    return {
      user,
      accessToken: token,
      authz,
      requireUser(): AuthUser {
        if (!user) {
          throw ApiError.unauthorized(AUTH_ERRORS.unauthorized);
        }
        return user;
      },
      async requireAuthz(capability: Capability): Promise<AuthorizationContext> {
        if (!user || !authz) {
          unauthorizedResponse();
        }
        return requireCapability(authz!, capability, { request });
      },
    };
  },
);

/**
 * Domain/admin route groups use this alias so call sites stay explicit.
 * Default-deny: every protected handler must call requireAuthz (no identity → 401).
 */
export const requireAuthPlugin = authPlugin;
