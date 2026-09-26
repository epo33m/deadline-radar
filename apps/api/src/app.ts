import { Elysia } from "elysia";
import { cors } from "@elysiajs/cors";
import { openapi } from "@elysiajs/openapi";

import { env } from "./env";
import { requestIdPlugin } from "./lib/api/request-id";
import { apiSchemas, apiSecuritySchemes } from "./lib/api/openapi-docs";
import { perfTimingPlugin } from "./plugins/perf-timing";
import { errorHandlerPlugin } from "./plugins/error-handler";
import { rateLimitPlugin } from "./plugins/rate-limit";
import { httpPolicyPlugin } from "./plugins/http-policy";
import { bodyLimitPlugin } from "./plugins/body-limit";
import { authRoutes } from "./routes/auth";
import { courseRoutes } from "./routes/courses";
import { taskRoutes } from "./routes/tasks";
import { summaryRoutes } from "./routes/summary";
import { attachmentRoutes } from "./routes/attachments";
import { notificationRoutes } from "./routes/notifications";
import { adminRoutes } from "./routes/admin";
import { cronRoutes } from "./routes/cron";
import { healthCronRoutes } from "./routes/health-cron";

export const app = new Elysia()
  // First: bracket every other plugin/handler in the [perf] wall time.
  .use(perfTimingPlugin)
  .use(requestIdPlugin)
  .use(errorHandlerPlugin)
  .use(
    cors({
      origin: env.webOrigin,
      credentials: true,
    }),
  )
  .use(bodyLimitPlugin)
  .use(rateLimitPlugin)
  .use(httpPolicyPlugin)
  .use(
    openapi({
      documentation: {
        info: {
          title: "Deadline Radar API",
          version: "1.0.0",
          description:
            "Backend API for Deadline Radar v1 (auth, courses, tasks, reminders).",
        },
        tags: [
          { name: "Health" },
          { name: "Auth" },
          { name: "Courses" },
          { name: "Tasks" },
          { name: "Summary" },
          { name: "Attachments" },
          { name: "Notifications" },
          { name: "Admin" },
          { name: "Cron" },
        ],
        components: {
          securitySchemes: apiSecuritySchemes,
          schemas: apiSchemas,
        },
      },
      path: "/openapi",
    }),
  )
  .get("/health", () => ({ ok: true, service: "deadline-radar-api" }), {
    detail: {
      tags: ["Health"],
      summary: "Health check",
      responses: {
        200: {
          description: "Service is up. Exempt from rate limiting.",
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["ok", "service"],
                properties: {
                  ok: { type: "boolean" },
                  service: { type: "string" },
                },
              },
            },
          },
        },
      },
    },
  })
  .use(authRoutes)
  .use(courseRoutes)
  .use(taskRoutes)
  .use(summaryRoutes)
  .use(attachmentRoutes)
  .use(notificationRoutes)
  .use(adminRoutes)
  .use(cronRoutes)
  .use(healthCronRoutes);

export type App = typeof app;
