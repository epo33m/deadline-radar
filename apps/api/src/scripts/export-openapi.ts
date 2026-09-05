/**
 * Export OpenAPI JSON from the running app module (no live server required).
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

process.env.NODE_ENV ??= "test";
process.env.AUTH_BRIDGE_SECRET ??= "export-openapi-bridge-secret";

const { app } = await import("../app");

const response = await app.handle(
  new Request("http://localhost/openapi/json"),
);
if (!response.ok) {
  console.error("OpenAPI export failed", response.status, await response.text());
  process.exit(1);
}

const spec = await response.json();
const out =
  process.argv[2] ??
  resolve(import.meta.dir, "../../../../apps/web/lib/api/openapi.json");
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, JSON.stringify(spec, null, 2) + "\n");
console.log(`Wrote OpenAPI document to ${out}`);
