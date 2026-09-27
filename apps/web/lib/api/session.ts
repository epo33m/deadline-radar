import { cache } from "react";

import type { TimeFormat } from "@deadline-radar/validation";

import { clearLocalAuthCookies } from "@/lib/api/server";
import { getBootstrap } from "@/lib/api/bootstrap";

export type SessionUser = {
  id: string;
  email?: string;
  timezone: string;
  timeFormat: TimeFormat;
  name: string | null;
  sessionId?: string | null;
  pendingEmail?: string | null;
};

/**
 * Session derived from the cold-navigation bootstrap (perf plan, Fase E).
 *
 * Same contract as before — React-cached, clears stale auth cookies when
 * unauthenticated — but reads the shared `getBootstrap()` instead of
 * `GET /api/v1/auth/session`, so session-only pages (settings, learn)
 * share the layout's single HTTP request instead of firing a second one.
 * `pendingEmail` is always null here (nobody reads it; email-change status
 * stays on `/api/v1/auth/session`, whose contract is untouched).
 */
export const getSession = cache(
  async (): Promise<{
    authenticated: boolean;
    user: SessionUser | null;
  }> => {
    const bootstrap = await getBootstrap();
    if (!bootstrap.user) {
      await clearLocalAuthCookies();
      return { authenticated: false, user: null };
    }
    return { authenticated: true, user: bootstrap.user };
  },
);

export async function requireSession(): Promise<SessionUser> {
  const session = await getSession();
  if (!session.user) {
    const { redirect } = await import("next/navigation");
    redirect("/login");
    throw new Error("unreachable");
  }
  return session.user;
}
