import { Elysia } from "elysia";

import {
  ACCESS_COOKIE,
  verifyAccessToken,
  type AuthUser,
} from "../lib/auth-tokens";

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

    return {
      user,
      accessToken: token,
      requireUser(): AuthUser {
        if (!user) {
          throw new Response(JSON.stringify({ error: "Unauthorized" }), {
            status: 401,
            headers: { "content-type": "application/json" },
          });
        }
        return user;
      },
    };
  },
);
