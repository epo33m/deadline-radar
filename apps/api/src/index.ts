import { app } from "./app";
import { env, assertStartupConfig } from "./env";
import { getDb } from "./lib/db";
import { installProcessGuards } from "./lib/process-guard";
import { initSentry } from "./lib/sentry";
import { createShutdownHandler } from "./lib/shutdown";
import { assertReminderSchemaPrerequisites } from "./lib/schema-prereqs";

initSentry();
// Issue #89: a single failed DB query must 500 that request, never kill the
// process. Last-resort containment for rejections that escape request scope.
installProcessGuards();
assertStartupConfig();
// RF-15: refuse to boot when the database is behind this API build in the
// way that would silently break every sweep claim. Only ever runs in
// production; non-prod boots skip the DB check.
await assertReminderSchemaPrerequisites();

app.listen(env.port);

console.log(
  `Deadline Radar API listening on http://127.0.0.1:${env.port} (openapi: /openapi)`,
);

// Graceful shutdown: drain instead of abandoning pooled Postgres connections.
// Without this even SIGTERM kills in-flight queries like kill -9 does (which
// is uncatchable by design and stays a last resort).
const onShutdownSignal = createShutdownHandler({
  stopServer: () => app.stop(),
  closePool: () => getDb().close(),
  exit: (code) => process.exit(code),
  log: (message) => console.log(message),
});
process.on("SIGTERM", () => void onShutdownSignal("SIGTERM"));
process.on("SIGINT", () => void onShutdownSignal("SIGINT"));
