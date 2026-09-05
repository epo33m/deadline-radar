import { app } from "./app";
import { env } from "./env";

function assertBootEnv(): void {
  if (env.isProduction && !env.authBridgeSecret()) {
    throw new Error(
      "AUTH_BRIDGE_SECRET is required in production (Next→API auth bridge)",
    );
  }
  if (env.isProduction && !env.cronSecret()) {
    throw new Error("CRON_SECRET is required in production");
  }
}

assertBootEnv();

app.listen(env.port);

console.log(
  `Deadline Radar API listening on http://127.0.0.1:${env.port} (openapi: /openapi)`,
);
