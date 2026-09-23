// Sentry browser init. DSN is public by design; PII scrubbed client-side
// before anything is sent.
import * as Sentry from "@sentry/nextjs";
import { sentryBeforeSend } from "./lib/sentry-scrub";

Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN ?? process.env.SENTRY_DSN,
  enabled: Boolean(
    process.env.NEXT_PUBLIC_SENTRY_DSN ?? process.env.SENTRY_DSN,
  ),
  environment: process.env.NODE_ENV ?? "development",
  sendDefaultPii: false,
  tracesSampleRate: 0.1,
  beforeSend: (event) =>
    sentryBeforeSend(event as unknown as Record<string, unknown>) as never,
});
