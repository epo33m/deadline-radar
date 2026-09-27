import { cache } from "react";

import type { ProgressSummary } from "@deadline-radar/domain";
import type { TimeFormat } from "@deadline-radar/validation";

import { apiJson, clearLocalAuthCookies } from "@/lib/api/server";
import type { WeekSummary } from "@/lib/summary/week";

export type BootstrapUser = {
  id: string;
  email?: string;
  timezone: string;
  timeFormat: TimeFormat;
  name: string | null;
  sessionId?: string | null;
  pendingEmail?: string | null;
};

export type BootstrapCourse = {
  id: string;
  userId: string;
  name: string;
  code: string | null;
  color: string | null;
  icon: string | null;
  description: string | null;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
};

export type BootstrapData = {
  user: BootstrapUser;
  courses: BootstrapCourse[];
  summary: WeekSummary;
  progress: ProgressSummary;
};

export type BootstrapResult =
  | (BootstrapData & { error?: undefined })
  | {
      user?: undefined;
      courses?: undefined;
      summary?: undefined;
      progress?: undefined;
      error: string;
    };

const SUMMARY_KEYS = [
  "today",
  "tomorrow",
  "thisWeek",
  "nextWeek",
  "thisMonth",
  "missed",
  "allTasks",
] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isWeekSummary(value: unknown): value is WeekSummary {
  return (
    isRecord(value) &&
    SUMMARY_KEYS.every((key) => isFiniteNumber(value[key]))
  );
}

function isProgressSummary(value: unknown): value is ProgressSummary {
  if (!isRecord(value)) return false;
  if (!isFiniteNumber(value.completed) || !isFiniteNumber(value.total)) {
    return false;
  }
  if (!isFiniteNumber(value.onTime) || !isFiniteNumber(value.onTimeTotal)) {
    return false;
  }
  return Array.isArray(value.courses);
}

function isBootstrapUser(value: unknown): value is BootstrapUser {
  if (!isRecord(value)) return false;
  return (
    typeof value.id === "string" &&
    typeof value.timezone === "string" &&
    (value.timeFormat === "12h" || value.timeFormat === "24h")
  );
}

function isBootstrapCourse(value: unknown): value is BootstrapCourse {
  if (!isRecord(value)) return false;
  return (
    typeof value.id === "string" &&
    typeof value.userId === "string" &&
    typeof value.name === "string" &&
    typeof value.createdAt === "string"
  );
}

/**
 * Cold-navigation bootstrap (perf plan, Fase E): user + courses + summary
 * in ONE API call (`GET /api/v1/bootstrap`).
 *
 * React-cached like `getSession`, so the layout and the page share a single
 * HTTP request per render pass. Unauthenticated (or malformed) responses
 * clear stale auth cookies exactly like the session path, and
 * `requireBootstrap` redirects to `/login` like `requireSession`.
 */
export const getBootstrap = cache(
  async (
    fetchJson: typeof apiJson = apiJson,
  ): Promise<BootstrapResult> => {
    const result = await fetchJson<{
      user?: BootstrapUser;
      courses?: BootstrapCourse[];
      summary?: WeekSummary;
      progress?: ProgressSummary;
    }>("/api/v1/bootstrap");

    if (
      !isBootstrapUser(result.user) ||
      !Array.isArray(result.courses) ||
      !result.courses.every(isBootstrapCourse) ||
      !isWeekSummary(result.summary) ||
      !isProgressSummary(result.progress)
    ) {
      if (!result.user) {
        await clearLocalAuthCookies();
      }
      return { error: "Could not load page data. Ensure the API is running." };
    }

    return {
      user: result.user,
      courses: result.courses,
      summary: result.summary,
      progress: result.progress,
    };
  },
);

export async function requireBootstrap(): Promise<BootstrapData> {
  const bootstrap = await getBootstrap();
  if (!bootstrap.user) {
    const { redirect } = await import("next/navigation");
    redirect("/login");
    throw new Error("unreachable");
  }
  return bootstrap;
}
