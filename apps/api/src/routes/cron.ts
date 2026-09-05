import { Elysia } from "elysia";

import { env } from "../env";
import { runEvaluateReminders } from "../services/run-evaluate";

function authorizeCron(request: Request): boolean {
  const secret = env.cronSecret();
  if (!secret) {
    return !env.isProduction;
  }
  const header = request.headers.get("authorization");
  return header === `Bearer ${secret}`;
}

export const cronRoutes = new Elysia({ prefix: "/api/cron" }).get(
  "/evaluate-reminders",
  async ({ request, set }) => {
    if (!authorizeCron(request)) {
      set.status = 401;
      return { error: "Unauthorized" };
    }
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
