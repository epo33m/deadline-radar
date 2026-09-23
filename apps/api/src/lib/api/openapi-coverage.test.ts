/**
 * Finding #10 verification: the served OpenAPI document matches the
 * registered `/api/v1` surface.
 * - A: every public route path+method is documented; no stale entries.
 * - B: request schemas match runtime validation (required fields, enums).
 * - C: protected ops carry security; public auth ops do not.
 * - D: Idempotency-Key / rate-limit headers documented where implemented.
 * - E: the docs UI route renders (checked separately via /openapi fetch).
 */
process.env.NODE_ENV = "test";
process.env.AUTH_BRIDGE_SECRET ??= "test-openapi-bridge-secret";
import { describe, expect, test } from "bun:test";

const { app } = await import("../../app");

type Spec = {
  paths: Record<string, Record<string, Record<string, unknown>>>;
  components?: {
    schemas?: Record<string, unknown>;
    securitySchemes?: Record<string, unknown>;
  };
};

let cached: Spec | null = null;
async function getSpec(): Promise<Spec> {
  if (!cached) {
    const response = await app.handle(
      new Request("http://localhost/openapi/json"),
    );
    expect(response.status).toBe(200);
    cached = (await response.json()) as Spec;
  }
  return cached;
}

function op(
  spec: Spec,
  method: string,
  path: string,
): Record<string, unknown> {
  const operations = spec.paths[path];
  expect(operations, `documented path ${path}`).toBeDefined();
  const operation = operations[method] as Record<string, unknown> | undefined;
  expect(operation, `documented ${method.toUpperCase()} ${path}`).toBeDefined();
  return operation as Record<string, unknown>;
}

function parametersOf(operation: Record<string, unknown>): Array<{
  name?: string;
  in?: string;
  required?: boolean;
}> {
  return (operation["parameters"] as Array<{
    name?: string;
    in?: string;
    required?: boolean;
  }>) ?? [];
}

// Registered public routes: [method, path] (Elysia-style, incl. trailing
// slashes as mounted). Health + cron included; /openapi itself excluded.
const PUBLIC_ROUTES: Array<[string, string]> = [
  ["get", "/health"],
  ["get", "/health/cron"],
  ["post", "/api/v1/auth/register"],
  ["post", "/api/v1/auth/login"],
  ["post", "/api/v1/auth/refresh"],
  ["post", "/api/v1/auth/logout"],
  ["post", "/api/v1/auth/logout-all"],
  ["post", "/api/v1/auth/forgot-password"],
  ["post", "/api/v1/auth/reset-password"],
  ["post", "/api/v1/auth/change-password"],
  ["post", "/api/v1/auth/change-email"],
  ["get", "/api/v1/auth/confirm"],
  ["get", "/api/v1/auth/session"],
  ["patch", "/api/v1/auth/timezone"],
  ["patch", "/api/v1/auth/time-format"],
  ["get", "/api/v1/courses/"],
  ["post", "/api/v1/courses/"],
  ["get", "/api/v1/courses/{id}"],
  ["patch", "/api/v1/courses/{id}"],
  ["delete", "/api/v1/courses/{id}"],
  ["get", "/api/v1/tasks/"],
  ["post", "/api/v1/tasks/"],
  ["get", "/api/v1/tasks/{id}"],
  ["patch", "/api/v1/tasks/{id}"],
  ["post", "/api/v1/tasks/{id}/complete"],
  ["delete", "/api/v1/tasks/{id}"],
  ["post", "/api/v1/tasks/{id}/thresholds"],
  ["put", "/api/v1/tasks/{id}/thresholds"],
  ["patch", "/api/v1/tasks/{id}/thresholds/{thresholdId}"],
  ["delete", "/api/v1/tasks/{id}/thresholds/{thresholdId}"],
  ["get", "/api/v1/summary/"],
  ["post", "/api/v1/attachments/link"],
  ["post", "/api/v1/attachments/file"],
  ["delete", "/api/v1/attachments/{id}"],
  ["get", "/api/v1/attachments/signed-url"],
  ["get", "/api/v1/notifications/"],
  ["get", "/api/v1/notifications/unread-count"],
  ["post", "/api/v1/notifications/{id}/read"],
  ["post", "/api/v1/notifications/read-all"],
  ["post", "/api/v1/admin/roles/assign"],
  ["post", "/api/v1/admin/roles/revoke"],
  ["get", "/api/v1/admin/audit"],
  ["get", "/api/v1/cron/evaluate-reminders"],
];

const PUBLIC_PATHS = [
  "/health",
  "/api/v1/auth/register",
  "/api/v1/auth/login",
  "/api/v1/auth/refresh",
  "/api/v1/auth/logout",
  "/api/v1/auth/forgot-password",
  "/api/v1/auth/confirm",
];

describe("finding #10 — openapi coverage", () => {
  test("A. every public route is documented, no stale entries", async () => {
    const spec = await getSpec();
    for (const [method, path] of PUBLIC_ROUTES) {
      op(spec, method, path);
    }
    const documented = new Set<string>();
    for (const [path, operations] of Object.entries(spec.paths)) {
      for (const method of Object.keys(operations)) {
        if (method === "parameters") continue;
        documented.add(`${method}:${path}`);
      }
    }
    const expected = new Set(
      PUBLIC_ROUTES.map(([method, path]) => `${method}:${path}`),
    );
    const missing = [...expected].filter((key) => !documented.has(key));
    const extra = [...documented].filter((key) => !expected.has(key));
    expect({ missing, extra }).toEqual({ missing: [], extra: [] });
  });

  test("B. request schemas match runtime validation", async () => {
    const spec = await getSpec();
    const schemaOf = (method: string, path: string) => {
      const operation = op(spec, method, path);
      const requestBody = operation["requestBody"] as {
        content?: {
          "application/json"?: { schema?: Record<string, unknown> };
        };
      };
      return requestBody?.content?.["application/json"]?.schema as
        | { required?: string[]; properties?: Record<string, unknown> }
        | undefined;
    };
    // Zod requires status on create/patch (actions default it client-side).
    expect(schemaOf("post", "/api/v1/tasks/")?.required).toEqual(
      expect.arrayContaining(["title", "course_id", "deadline", "status"]),
    );
    expect(schemaOf("post", "/api/v1/auth/login")?.required).toEqual(
      expect.arrayContaining(["email", "password"]),
    );
    expect(
      schemaOf("post", "/api/v1/auth/reset-password")?.required,
    ).toEqual(expect.arrayContaining(["password", "confirmPassword"]));
    expect(schemaOf("post", "/api/v1/attachments/link")?.required).toEqual(
      expect.arrayContaining(["task_id", "url"]),
    );
    // List/filter/sort parameters actually implemented.
    const listParams = parametersOf(op(spec, "get", "/api/v1/tasks/")).map(
      (parameter) => parameter.name,
    );
    expect(listParams).toEqual(
      expect.arrayContaining(["courseId", "limit", "cursor", "sort"]),
    );
    const signedParams = parametersOf(
      op(spec, "get", "/api/v1/attachments/signed-url"),
    );
    expect(signedParams.map((parameter) => parameter.name)).toContain(
      "storage_path",
    );
  });

  test("C. protected ops require auth, public auth ops do not", async () => {
    const spec = await getSpec();
    expect(
      spec.components?.securitySchemes?.["bearerAuth"],
    ).toBeDefined();
    const secured = (method: string, path: string) =>
      (op(spec, method, path)["security"] as unknown[]) ?? [];
    for (const [method, path] of [
      ["patch", "/api/v1/auth/timezone"],
      ["get", "/api/v1/tasks/"],
      ["post", "/api/v1/tasks/"],
      ["get", "/api/v1/notifications/"],
      ["post", "/api/v1/admin/roles/assign"],
      ["get", "/api/v1/cron/evaluate-reminders"],
    ] as Array<[string, string]>) {
      expect(secured(method, path).length).toBeGreaterThan(0);
    }
    for (const [method, path] of [
      ["post", "/api/v1/auth/login"],
      ["post", "/api/v1/auth/register"],
      ["post", "/api/v1/auth/forgot-password"],
      ["get", "/api/v1/auth/confirm"],
      ["post", "/api/v1/auth/logout"],
      ["get", "/health"],
    ] as Array<[string, string]>) {
      expect(secured(method, path).length).toBe(0);
    }
  });

  test("D. operational headers documented where implemented", async () => {
    const spec = await getSpec();
    const headerParams = (method: string, path: string) =>
      parametersOf(op(spec, method, path))
        .filter((parameter) => parameter.in === "header")
        .map((parameter) => parameter.name);
    for (const [method, path] of [
      ["post", "/api/v1/tasks/"],
      ["post", "/api/v1/courses/"],
      ["post", "/api/v1/attachments/link"],
      ["post", "/api/v1/attachments/file"],
      ["post", "/api/v1/admin/roles/assign"],
    ] as Array<[string, string]>) {
      expect(headerParams(method, path)).toContain("Idempotency-Key");
    }
    // Endpoints without idempotency support must not claim it.
    expect(headerParams("post", "/api/v1/admin/roles/revoke")).not.toContain(
      "Idempotency-Key",
    );
    // Rate-limit headers on throttled responses.
    const login = op(spec, "post", "/api/v1/auth/login");
    const responses = login["responses"] as Record<
      string,
      { headers?: Record<string, unknown> }
    >;
    expect(Object.keys(responses)).toEqual(
      expect.arrayContaining(["200", "400", "401", "429"]),
    );
    expect(responses["429"].headers?.["X-RateLimit-Limit"]).toBeDefined();
  });

  test("E. error envelope component matches the runtime contract", async () => {
    const spec = await getSpec();
    const errorBody = spec.components?.schemas?.["ErrorBody"] as
      | { required?: string[]; properties?: Record<string, unknown> }
      | undefined;
    expect(errorBody?.required).toEqual(
      expect.arrayContaining(["error", "requestId"]),
    );
    const login = op(spec, "post", "/api/v1/auth/login");
    const responses = login["responses"] as Record<
      string,
      { content?: { "application/json"?: { schema?: unknown } } }
    >;
    expect(responses["401"].content?.["application/json"]?.schema).toEqual({
      $ref: "#/components/schemas/ErrorBody",
    });
  });
});
