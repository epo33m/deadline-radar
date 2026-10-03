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

/**
 * Whether the response is served over TLS. TLS-dependent cookie attributes
 * (`Secure`) key on the request origin, never on `NODE_ENV` — same defect
 * family as #58/#59, where an environment gate emitted TLS-only directives
 * from `next start` on plain-HTTP loopback.
 *
 * Precedence: the platform's forwarded proto first, then the request URL.
 * Server Actions have no URL: there a loopback `Host` means a direct
 * plain-HTTP server and anything else fails closed to secure.
 *
 * Forwarded entries: proxies append, so the LAST entry is the one written by
 * the edge closest to this server; the first entry is client-controllable
 * (Finding: #123, web/secure-flag-xforwarded-proto-trust-gap). Trusting the
 * first entry let a caller inject `X-Forwarded-Proto: http` and strip the
 * `Secure` flag from freshly issued cookies.
 */
export function isSecureRequest(input: {
  forwardedProto?: string | null;
  protocol?: string;
  host?: string | null;
}): boolean {
  const forwardedEntries = input.forwardedProto
    ?.split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
  const forwarded = forwardedEntries?.[forwardedEntries.length - 1];
  if (forwarded) return forwarded.replace(/:$/, "") !== "http";
  if (input.protocol) return input.protocol.replace(/:$/, "") !== "http";
  const rawHost = (input.host ?? "").toLowerCase();
  const hostname = rawHost.startsWith("[")
    ? (rawHost.slice(1).split("]")[0] ?? "")
    : (rawHost.split(":")[0] ?? "");
  if (
    hostname === "localhost" ||
    hostname === "::1" ||
    hostname === "127.0.0.1" ||
    hostname.startsWith("127.")
  ) {
    return false;
  }
  return true;
}

export function authCookieOptions(maxAgeSeconds: number, isSecure: boolean) {
  return {
    httpOnly: true as const,
    secure: isSecure,
    sameSite: "lax" as const,
    path: "/",
    maxAge: maxAgeSeconds,
  };
}

/**
 * Deletion scope must match creation scope (Finding #12): browsers only
 * remove a cookie when name + domain + path match, and a `Secure` cookie
 * cannot be cleared by a non-`Secure` Set-Cookie. No `Domain` is set on
 * creation, so none is set here (host-only cookies).
 *
 * `SameSite=Lax` (not Strict) is deliberate: the email recovery/confirm
 * links are cross-site top-level navigations that must still establish the
 * session; `Strict` would withhold cookies on that first navigation and
 * break the recovery flow. `Lax` still blocks cookies on cross-site
 * subresource/POST requests, which is the CSRF-relevant case.
 */
export function clearedAuthCookieOptions(isSecure: boolean) {
  return {
    httpOnly: true as const,
    secure: isSecure,
    sameSite: "lax" as const,
    path: "/",
    maxAge: 0,
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
