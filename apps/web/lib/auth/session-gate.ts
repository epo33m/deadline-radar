/**
 * Public page allowlist — everything else requires a session (fail closed).
 *
 * `/privacy` and `/terms` are here because the landing footer links both
 * (`LEGAL_LINKS` in `@/lib/legal`, rendered by `landing-footer.tsx` on `/` and on
 * the legal pages themselves). Without them a signed-out visitor who clicks
 * "Privacy Policy" is bounced to `/login` and only reaches the page after
 * authenticating. Both are static legal documents with no data access, so the
 * gate protected nothing (#75).
 *
 * This list is a trust boundary: adding a path here makes it reachable without
 * a session. `session-gate.test.ts` pins both directions — these two are
 * allowed, and unknown paths are still redirected.
 */
const PUBLIC_EXACT = new Set(["/", "/privacy", "/terms"]);

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
  | { action: "redirect"; to: "/login" | "/summary" };

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
    return { action: "redirect", to: "/summary" };
  }

  return { action: "allow" };
}
