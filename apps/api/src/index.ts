import { app } from "./app";
import { env } from "./env";

app.listen(env.port);

console.log(
  `Deadline Radar API listening on http://127.0.0.1:${env.port} (openapi: /openapi)`,
);
