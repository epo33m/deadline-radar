import { Elysia } from "elysia";

import { env } from "../env";
import { runEvaluateReminders } from "../services/run-evaluate";
import { ApiError } from "../lib/api/errors";

function authorizeCron(request: Request): void {
  const secret = env.cronSecret();
  // Always require CRON_SECRET except in automated tests.
  if (!secret) {
    if (env.isTest) return;
    throw ApiError.unauthorized("Cron secret not configured");
  }
  const header = request.headers.get("authorization");
  if (header !== `Bearer ${secret}`) {
    throw ApiError.unauthorized();
  }
}

export const cronRoutes = new Elysia({ prefix: "/api/v1/cron" }).get(
  "/evaluate-reminders",
  async ({ request }) => {
    authorizeCron(request);
    const result = await runEvaluateReminders();
    return { ok: true, ...result };
  },
  {
    detail: {
      tags: ["Cron"],
      summary: "Evaluate reminder thresholds and send notifications",
    },
  },
);
