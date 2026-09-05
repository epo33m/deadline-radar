import { app } from "../app";

const spec = app.getResponse?.("GET", "/openapi/json") ?? null;

// Prefer Elysia's built-in OpenAPI document if available at runtime.
const documentation =
  // @ts-expect-error internal access for export script
  app.decorator?.["~openapi"] ??
  null;

console.log(
  JSON.stringify(
    {
      note: "Start the API and fetch GET /openapi/json, or use web generate-api against a running server.",
      documentationPresent: Boolean(documentation),
      spec,
    },
    null,
    2,
  ),
);
