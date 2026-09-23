// Sentry server-side init (audit item 7). No-op without SENTRY_DSN.
import * as Sentry from "@sentry/nextjs";
import { sentryBeforeSend } from "./lib/sentry-scrub";

Sentry.init({
  dsn: process.env.SENTRY_DSN,
  enabled: Boolean(process.env.SENTRY_DSN),
  environment: process.env.NODE_ENV ?? "development",
  sendDefaultPii: false,
  tracesSampleRate: 0.1,
  beforeSend: (event) =>
    sentryBeforeSend(event as unknown as Record<string, unknown>) as never,
});
