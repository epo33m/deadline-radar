import { Elysia } from "elysia";
import { desc } from "drizzle-orm";

import { reminderRuns } from "@deadline-radar/db";

import { env } from "../env";
import { getDb } from "../lib/db";

/**
 * RF-14: scheduler health gate for external uptime monitors.
 *
 * Unlike /health (process up), this answers "is the reminder pipeline actually
 * running": the most recent scheduler run must have completed OK and started
 * within 2 × REMINDER_RUN_INTERVAL_MS (default 1h). A dead scheduler leaves
 * either a stale ok row or a hanging `running` row — both are 503 here, so a
 * plain HTTP poll (UptimeRobot, etc.) becomes the "no ok run within 2×
 * interval" alert the runbook asks for.
 *
 * Public + read-only + minimal payload (no email addresses, no ledger
 * contents): scheduler availability is not sensitive, and an unauthenticated
 * monitor must be able to poll it. Rate limiting still applies (general
 * bucket), which a one-a-minute monitor never approaches.
 */
export const healthCronRoutes = new Elysia().get(
  "/health/cron",
  async ({ set }) => {
    const db = getDb();
    const [row] = await db
      .select({
        startedAt: reminderRuns.startedAt,
        finishedAt: reminderRuns.finishedAt,
        status: reminderRuns.status,
        evaluatedTasks: reminderRuns.evaluatedTasks,
      })
      .from(reminderRuns)
      .orderBy(desc(reminderRuns.startedAt))
      .limit(1);

    const intervalMs = env.runIntervalMs();
    const lastRunAt = row?.startedAt ? row.startedAt.toISOString() : null;
    const healthy =
      row !== undefined &&
      row.status === "ok" &&
      row.finishedAt !== null &&
      Date.now() - row.startedAt.getTime() <= 2 * intervalMs;

    if (!healthy) set.status = 503;
    return {
      ok: healthy,
      lastRunAt,
      lastStatus: row?.status ?? null,
      evaluatedTasks: row?.evaluatedTasks ?? null,
    };
  },
  {
    detail: {
      tags: ["Health"],
      summary: "Scheduler health (reminder runs)",
      description:
        "Public read-only probe for external monitors: 200 when the latest " +
        "reminder run completed OK within 2 × REMINDER_RUN_INTERVAL_MS, 503 " +
        "when the scheduler is missing, stale, erroring, or whose latest run " +
        "is stuck `running`.",
      responses: {
        200: {
          description:
            "Latest scheduler run OK and within the freshness window.",
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["ok", "lastRunAt", "lastStatus", "evaluatedTasks"],
                properties: {
                  ok: { type: "boolean" },
                  lastRunAt: { type: "string", format: "date-time", nullable: true },
                  lastStatus: {
                    type: "string",
                    enum: ["running", "ok", "error"],
                    nullable: true,
                  },
                  evaluatedTasks: { type: "integer", nullable: true },
                },
              },
            },
          },
        },
        503: { description: "Scheduler unhealthy (see body for why)." },
      },
    },
  },
);