import { cache } from "react";

import type { TimeFormat } from "@deadline-radar/validation";

import { apiJson, clearLocalAuthCookies } from "@/lib/api/server";

export type SessionUser = {
  id: string;
  email?: string;
  timezone: string;
  timeFormat: TimeFormat;
  name: string | null;
  sessionId?: string | null;
  pendingEmail?: string | null;
};

export const getSession = cache(
  async (): Promise<{
    authenticated: boolean;
    user: SessionUser | null;
  }> => {
    const result = await apiJson<{
      authenticated?: boolean;
      user?: SessionUser;
    }>("/api/v1/auth/session");

    if (!result.authenticated || !result.user) {
      await clearLocalAuthCookies();
      return { authenticated: false, user: null };
    }

    return { authenticated: true, user: result.user };
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
