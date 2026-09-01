const PROTECTED_PREFIXES = [
  "/dashboard",
  "/courses",
  "/tasks",
  "/calendar",
  "/notifications",
  "/settings",
] as const;

const AUTH_PATHS = ["/login", "/register", "/forgot-password"] as const;

export type SessionGateInput = {
  hasSession: boolean;
  pathname: string;
};

export type SessionGateResult =
  | { action: "allow" }
  | { action: "redirect"; to: "/login" | "/dashboard" };

function matchesPrefix(pathname: string, prefix: string): boolean {
  return pathname === prefix || pathname.startsWith(`${prefix}/`);
}

export function resolveSessionGate({
  hasSession,
  pathname,
}: SessionGateInput): SessionGateResult {
  const isProtected = PROTECTED_PREFIXES.some((prefix) =>
    matchesPrefix(pathname, prefix),
  );
  const isAuthPage = AUTH_PATHS.some((path) => matchesPrefix(pathname, path));

  if (!hasSession && isProtected) {
    return { action: "redirect", to: "/login" };
  }

  if (hasSession && isAuthPage) {
    return { action: "redirect", to: "/dashboard" };
  }

  return { action: "allow" };
}
