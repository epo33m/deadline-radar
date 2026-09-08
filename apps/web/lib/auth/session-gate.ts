/** Public page allowlist — everything else requires a session (fail closed). */
const PUBLIC_EXACT = new Set(["/"]);

const PUBLIC_PREFIXES = [
  "/login",
  "/register",
  "/forgot-password",
  "/reset-password",
  "/auth/confirm",
] as const;

const AUTH_REDIRECT_PATHS = [
  "/login",
  "/register",
  "/forgot-password",
] as const;

export type SessionGateInput = {
  hasSession: boolean;
  pathname: string;
};

export type SessionGateResult =
  | { action: "allow" }
  | { action: "redirect"; to: "/login" | "/overview" };

function matchesPrefix(pathname: string, prefix: string): boolean {
  return pathname === prefix || pathname.startsWith(`${prefix}/`);
}

export function isPublicPath(pathname: string): boolean {
  if (PUBLIC_EXACT.has(pathname)) return true;
  return PUBLIC_PREFIXES.some((prefix) => matchesPrefix(pathname, prefix));
}

export function resolveSessionGate({
  hasSession,
  pathname,
}: SessionGateInput): SessionGateResult {
  const isPublic = isPublicPath(pathname);
  const isAuthPage = AUTH_REDIRECT_PATHS.some((path) =>
    matchesPrefix(pathname, path),
  );

  if (!hasSession && !isPublic) {
    return { action: "redirect", to: "/login" };
  }

  if (hasSession && isAuthPage) {
    return { action: "redirect", to: "/overview" };
  }

  return { action: "allow" };
}
