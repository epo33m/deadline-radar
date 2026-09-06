/** Mirrored with apps/api/src/lib/auth-tokens.ts — keep cookie names in sync. */
export const ACCESS_COOKIE = "dr_access_token";
export const REFRESH_COOKIE = "dr_refresh_token";
export const AUTH_BRIDGE_HEADER = "x-dr-auth-bridge";

/** Shared secret for Next→API token JSON. Never use the literal "1". */
export function authBridgeSecret(): string {
  const secret = process.env.AUTH_BRIDGE_SECRET;
  if (!secret) {
    throw new Error("Missing required env var: AUTH_BRIDGE_SECRET");
  }
  return secret;
}

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
  error?: string | { code?: string; message?: string; details?: unknown };
  redirectTo?: string;
  ok?: boolean;
  message?: string;
  success?: string;
  requestId?: string;
};

function normalizeErrorField(
  data: AuthTokenBody,
): AuthTokenBody {
  if (data.error && typeof data.error === "object" && data.error.message) {
    return { ...data, error: data.error.message };
  }
  return data;
}

/** Strip tokens before returning JSON to the browser. */
export function stripAuthTokens<T extends AuthTokenBody>(
  data: T,
): Omit<T, "accessToken" | "refreshToken" | "expiresIn"> {
  const normalized = normalizeErrorField(data);
  const safe = { ...normalized } as Partial<T>;
  delete safe.accessToken;
  delete safe.refreshToken;
  delete safe.expiresIn;
  return safe as Omit<T, "accessToken" | "refreshToken" | "expiresIn">;
}
