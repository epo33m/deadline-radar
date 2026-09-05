/** Internal header: Next auth bridges may receive tokens in JSON; browsers must not. */
export const AUTH_BRIDGE_HEADER = "x-dr-auth-bridge";
export const AUTH_BRIDGE_VALUE = "1";

export function isAuthBridgeRequest(request: Request): boolean {
  return request.headers.get(AUTH_BRIDGE_HEADER) === AUTH_BRIDGE_VALUE;
}

export type SessionTokenPayload = {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
};

/**
 * Attach session tokens to a response body only for trusted server bridges.
 */
export function withBridgeTokens<T extends Record<string, unknown>>(
  body: T,
  tokens: SessionTokenPayload | null,
  bridge: boolean,
): T & Partial<SessionTokenPayload> {
  if (!bridge || !tokens) return body;
  return {
    ...body,
    accessToken: tokens.accessToken,
    refreshToken: tokens.refreshToken,
    expiresIn: tokens.expiresIn,
  };
}
