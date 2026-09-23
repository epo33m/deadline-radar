import { app } from "./app";
import { env, assertStartupConfig } from "./env";
import { initSentry } from "./lib/sentry";
import { assertReminderSchemaPrerequisites } from "./lib/schema-prereqs";

initSentry();
assertStartupConfig();
// RF-15: refuse to boot when the database is behind this API build in the
// way that would silently break every sweep claim. Only ever runs in
// production; non-prod boots skip the DB check.
await assertReminderSchemaPrerequisites();

app.listen(env.port);

console.log(
  `Deadline Radar API listening on http://127.0.0.1:${env.port} (openapi: /openapi)`,
);
