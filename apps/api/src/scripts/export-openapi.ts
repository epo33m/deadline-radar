/**
 * Export helper for OpenAPI metadata.
 * Prefer fetching GET /openapi from a running API for the full document.
 */
import { app } from "../app";

const openapiMounted = Boolean(
  // Elysia route graph includes /openapi when the openapi plugin is registered.
  app.routes?.some(
    (route) =>
      typeof route.path === "string" && route.path.includes("openapi"),
  ),
);

console.log(
  JSON.stringify(
    {
      note: "Start the API and fetch GET /openapi (or /openapi/json) for the full document; use web generate-api against a running server.",
      openapiMounted,
      service: "deadline-radar-api",
    },
    null,
    2,
  ),
);
