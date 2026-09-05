/** Mirrored with apps/api/src/lib/auth-tokens.ts — keep cookie names in sync. */
export const ACCESS_COOKIE = "dr_access_token";
export const REFRESH_COOKIE = "dr_refresh_token";
export const AUTH_BRIDGE_HEADER = "x-dr-auth-bridge";
export const AUTH_BRIDGE_VALUE = "1";

export const REFRESH_COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 30;

export function authCookieOptions(maxAgeSeconds: number) {
  return {
    httpOnly: true as const,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax" as const,
    path: "/",
    maxAge: maxAgeSeconds,
  };
}

export type AuthTokenBody = {
  accessToken?: string;
  refreshToken?: string;
  expiresIn?: number;
  error?: string;
  redirectTo?: string;
  ok?: boolean;
};

/** Strip tokens before returning JSON to the browser. */
export function stripAuthTokens<T extends AuthTokenBody>(
  data: T,
): Omit<T, "accessToken" | "refreshToken" | "expiresIn"> {
  const safe = { ...data };
  delete safe.accessToken;
  delete safe.refreshToken;
  delete safe.expiresIn;
  return safe;
}
