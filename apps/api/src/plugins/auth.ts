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

function requestIdFrom(request: Request): string | null {
  return (
    request.headers.get("x-request-id") ??
    request.headers.get("x-correlation-id")
  );
}

/**
 * Authentication + authorization derive.
 * Identity from JWT/cookie; roles/capabilities from DB (never from the client).
 */
export const authPlugin = new Elysia({ name: "auth" }).derive(
  { as: "scoped" },
  async ({ cookie, request }) => {
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

    const authz: AuthorizationContext | null = user
      ? await loadAuthorizationContext(user, requestIdFrom(request))
      : null;

    return {
      user,
      accessToken: token,
      authz,
      requireUser(): AuthUser {
        if (!user) {
          throw new Response(
            JSON.stringify({ error: AUTH_ERRORS.unauthorized }),
            {
              status: 401,
              headers: { "content-type": "application/json" },
            },
          );
        }
        return user;
      },
      async requireAuthz(capability: Capability): Promise<AuthorizationContext> {
        if (!user || !authz) {
          throw unauthorizedResponse();
        }
        return requireCapability(authz, capability, { request });
      },
    };
  },
);

/**
 * Domain/admin route groups use this alias so call sites stay explicit.
 * Default-deny: every protected handler must call requireAuthz (no identity → 401).
 */
export const requireAuthPlugin = authPlugin;
