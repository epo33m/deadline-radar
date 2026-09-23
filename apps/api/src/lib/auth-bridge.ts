import { env } from "../env";

/** Internal header: Next auth bridges may receive tokens in JSON; browsers must not. */
export const AUTH_BRIDGE_HEADER = "x-dr-auth-bridge";

/**
 * Trusted server bridges must send `x-dr-auth-bridge: <AUTH_BRIDGE_SECRET>`.
 * The legacy value "1" is never accepted.
 */
export function isAuthBridgeRequest(request: Request): boolean {
  const secret = env.authBridgeSecret();
  if (!secret) return false;
  const header = request.headers.get(AUTH_BRIDGE_HEADER);
  if (!header) return false;
  return timingSafeEqualString(header, secret);
}

/**
 * Constant-time string comparison for shared secrets (Finding #11).
 * Length mismatch short-circuits to false (safe: no throw, no oracle beyond
 * length, which is not secret); equal lengths compare every code unit so the
 * timing does not reveal the mismatch position. Reused by cron auth.
 */
export function timingSafeEqualString(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let out = 0;
  for (let i = 0; i < a.length; i++) {
    out |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return out === 0;
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
