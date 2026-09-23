/**
 * Shared OpenAPI documentation fragments (Finding #10, docs-only).
 *
 * - `secured()`: marks operations that require a verified identity
 *   (Bearer access token OR `dr_access_token` cookie, per the auth plugin).
 * - `apiDoc()`: success envelope + the error statuses actually reachable
 *   for the operation. Error bodies always use the shared `ErrorBody`
 *   component: `{ error: { code, message, details }, requestId }`.
 * - Success schemas mirror `lib/api/serialize.ts` DTOs (verified, not
 *   invented). Envelopes only list top-level keys the handler returns.
 */
import type { OpenAPIV3 } from "openapi-types";

type Schema = OpenAPIV3.SchemaObject;
type AnySchema = OpenAPIV3.SchemaObject | OpenAPIV3.ReferenceObject;

const ref = (name: string): OpenAPIV3.ReferenceObject => ({
  $ref: `#/components/schemas/${name}`,
});

/** Auth mechanisms enforced by the auth plugin / cron guard. */
export const apiSecuritySchemes: Record<
  string,
  OpenAPIV3.SecuritySchemeObject
> = {
  bearerAuth: {
    type: "http",
    scheme: "bearer",
    bearerFormat: "JWT",
    description:
      "Supabase access JWT in the `Authorization: Bearer <token>` header.",
  },
  cookieAuth: {
    type: "apiKey",
    in: "cookie",
    name: "dr_access_token",
    description: "Same access JWT in the `dr_access_token` HttpOnly cookie.",
  },
  cronSecret: {
    type: "http",
    scheme: "bearer",
    description: "`Authorization: Bearer <CRON_SECRET>` for cron routes.",
  },
};

const isoDateTime: Schema = { type: "string", format: "date-time" };
const nullableIso: Schema = { type: "string", format: "date-time", nullable: true };
const uuid: Schema = { type: "string", format: "uuid" };

/**
 * Component schemas mirroring `lib/api/serialize.ts` DTOs (verified shapes,
 * including nullability). Envelopes reference these.
 */
export const apiSchemas: Record<string, Schema> = {
  ErrorBody: {
    type: "object",
    required: ["error", "requestId"],
    properties: {
      error: {
        type: "object",
        required: ["code", "message", "details"],
        properties: {
          code: {
            type: "string",
            enum: [
              "VALIDATION_ERROR",
              "UNAUTHORIZED",
              "FORBIDDEN",
              "NOT_FOUND",
              "CONFLICT",
              "RATE_LIMITED",
              "PAYLOAD_TOO_LARGE",
              "DEPENDENCY_FAILURE",
              "TIMEOUT",
              "INTERNAL",
              "IDEMPOTENCY_CONFLICT",
            ],
          },
          message: { type: "string" },
          details: {
            type: "array",
            items: {
              type: "object",
              properties: {
                field: { type: "string" },
                message: { type: "string" },
              },
            },
          },
        },
      },
      requestId: { type: "string", format: "uuid" },
    },
  },
  Page: {
    type: "object",
    required: ["nextCursor", "limit"],
    properties: {
      nextCursor: { type: "string", nullable: true },
      limit: { type: "integer" },
    },
  },
  Course: {
    type: "object",
    required: [
      "id",
      "userId",
      "name",
      "code",
      "color",
      "icon",
      "description",
      "createdAt",
      "updatedAt",
      "deletedAt",
    ],
    properties: {
      id: uuid,
      userId: uuid,
      name: { type: "string" },
      code: { type: "string", nullable: true },
      color: { type: "string", nullable: true },
      icon: { type: "string", nullable: true },
      description: { type: "string", nullable: true },
      createdAt: isoDateTime,
      updatedAt: isoDateTime,
      deletedAt: nullableIso,
    },
  },
  Task: {
    type: "object",
    required: [
      "id",
      "userId",
      "courseId",
      "title",
      "description",
      "deadline",
      "status",
      "createdAt",
      "updatedAt",
      "completedAt",
      "deletedAt",
    ],
    properties: {
      id: uuid,
      userId: uuid,
      courseId: uuid,
      title: { type: "string" },
      description: { type: "string", nullable: true },
      deadline: isoDateTime,
      status: { type: "string", enum: ["todo", "in_progress", "done"] },
      createdAt: isoDateTime,
      updatedAt: isoDateTime,
      completedAt: nullableIso,
      deletedAt: nullableIso,
      courseName: { type: "string", nullable: true },
      courseColor: { type: "string", nullable: true },
    },
  },
  Threshold: {
    type: "object",
    required: ["id", "taskId", "daysBefore", "isDefault", "createdAt"],
    properties: {
      id: uuid,
      taskId: uuid,
      daysBefore: { type: "integer", minimum: 0 },
      isDefault: { type: "boolean" },
      createdAt: isoDateTime,
    },
  },
  /**
   * Task row with joined course display fields (GET /api/v1/tasks list).
   * Slim list projection — `serializeTaskList` omits `description`
   * (unbounded text × N rows); detail endpoints use {@link Task} with the
   * full shape. Registered separately because the list endpoint references
   * this name; a missing component breaks OpenAPI bundling
   * (`$ref` with no target).
   */
  TaskWithCourse: {
    type: "object",
    required: [
      "id",
      "userId",
      "courseId",
      "title",
      "deadline",
      "status",
      "createdAt",
      "updatedAt",
      "completedAt",
      "deletedAt",
    ],
    properties: {
      id: uuid,
      userId: uuid,
      courseId: uuid,
      title: { type: "string" },
      deadline: isoDateTime,
      status: { type: "string", enum: ["todo", "in_progress", "done"] },
      createdAt: isoDateTime,
      updatedAt: isoDateTime,
      completedAt: nullableIso,
      deletedAt: nullableIso,
      courseName: { type: "string", nullable: true },
      courseColor: { type: "string", nullable: true },
    },
  },
  Attachment: {
    type: "object",
    required: [
      "id",
      "taskId",
      "type",
      "notes",
      "storagePath",
      "url",
      "createdAt",
    ],
    properties: {
      id: uuid,
      taskId: uuid,
      type: { type: "string", enum: ["link", "file"] },
      notes: { type: "string", nullable: true },
      storagePath: { type: "string", nullable: true },
      url: { type: "string", nullable: true },
      createdAt: isoDateTime,
    },
  },
  NotificationItem: {
    type: "object",
    required: [
      "id",
      "taskId",
      "thresholdId",
      "channel",
      "status",
      "retryCount",
      "sentAt",
      "readAt",
      "createdAt",
      "taskTitle",
      "daysBefore",
      "isLate",
    ],
    properties: {
      id: uuid,
      taskId: uuid,
      thresholdId: uuid,
      channel: { type: "string" },
      status: { type: "string" },
      retryCount: { type: "integer" },
      sentAt: nullableIso,
      readAt: nullableIso,
      createdAt: isoDateTime,
      taskTitle: { type: "string", nullable: true },
      daysBefore: { type: "integer", nullable: true },
      isLate: { type: "boolean" },
    },
  },
  AuditEvent: {
    type: "object",
    required: [
      "id",
      "event",
      "userId",
      "sessionId",
      "result",
      "method",
      "ip",
      "userAgent",
      "requestId",
      "metadata",
      "createdAt",
    ],
    properties: {
      id: uuid,
      event: { type: "string" },
      userId: { type: "string", nullable: true },
      sessionId: { type: "string", nullable: true },
      result: { type: "string" },
      method: { type: "string", nullable: true },
      ip: { type: "string", nullable: true },
      userAgent: { type: "string", nullable: true },
      requestId: { type: "string", nullable: true },
      metadata: { type: "object", nullable: true, additionalProperties: true },
      createdAt: isoDateTime,
    },
  },
  SessionUser: {
    type: "object",
    required: [
      "id",
      "email",
      "timezone",
      "timeFormat",
      "name",
      "sessionId",
      "pendingEmail",
    ],
    properties: {
      id: uuid,
      email: { type: "string", nullable: true },
      timezone: { type: "string" },
      timeFormat: { type: "string", enum: ["24h", "12h"] },
      name: { type: "string", nullable: true },
      sessionId: { type: "string", nullable: true },
      pendingEmail: { type: "string", nullable: true },
    },
  },
};

export function secured(): {
  security: OpenAPIV3.SecurityRequirementObject[];
} {
  return { security: [{ bearerAuth: [] }, { cookieAuth: [] }] };
}

export const IDEMPOTENCY_KEY_HEADER: OpenAPIV3.ParameterObject = {
  name: "Idempotency-Key",
  in: "header",
  required: false,
  description:
    "Optional client key (8–128 chars) for safe retries. Same key + same " +
    "request replays the stored response; same key + different request " +
    "returns 409.",
  schema: { type: "string", minLength: 8, maxLength: 128 },
};

export function idempotent(): {
  parameters: OpenAPIV3.ParameterObject[];
} {
  return { parameters: [IDEMPOTENCY_KEY_HEADER] };
}

const ERROR_DESCRIPTIONS: Record<number, string> = {
  400: "Validation failed. See `error.details` for per-field messages.",
  401: "Missing, invalid, or expired credentials/session.",
  403: "Authenticated, but the required capability/ownership check failed.",
  404: "Resource not found (generic — no existence oracle).",
  409: "Conflict: stale `updatedAt`, duplicate threshold, role already assigned, or `Idempotency-Key` reused with a different request.",
  413: "Request body exceeds the size limit.",
  429: "Rate limit exceeded. Back off and retry.",
  500: "Internal error (generic message only).",
  502: "Upstream storage dependency failed.",
};

export function apiDoc(options: {
  /** Success body schema (inline or component $ref). */
  ok: AnySchema;
  /** Success status. Defaults to 200. */
  status?: number;
  /** Success description override. */
  description?: string;
  /** Reachable error statuses (subset of the table above). */
  errors?: number[];
  /** Per-status body schema overrides (default: shared ErrorBody). */
  errorSchemas?: Record<number, AnySchema>;
  /** Extra responses merged verbatim (e.g. 302 redirects, 202 variants). */
  extraResponses?: OpenAPIV3.ResponsesObject;
  /** Extra header params (e.g. Idempotency-Key via `idempotent()`). */
  headers?: OpenAPIV3.ParameterObject[];
}): {
  responses: OpenAPIV3.ResponsesObject;
  parameters?: OpenAPIV3.ParameterObject[];
} {
  const status = options.status ?? 200;
  const responses: OpenAPIV3.ResponsesObject = {
    [status]: {
      description: options.description ?? "Success",
      content: { "application/json": { schema: options.ok } },
    },
  };
  for (const code of options.errors ?? []) {
    const bodySchema = options.errorSchemas?.[code] ?? ref("ErrorBody");
    const response: OpenAPIV3.ResponseObject = {
      description: ERROR_DESCRIPTIONS[code] ?? "Error",
      content: { "application/json": { schema: bodySchema } },
    };
    if (code === 429) {
      response.headers = {
        "X-RateLimit-Limit": {
          description: "Bucket size for the matched scope.",
          schema: { type: "integer" },
        },
        "X-RateLimit-Remaining": {
          description: "Remaining requests in the current window.",
          schema: { type: "integer" },
        },
        "X-RateLimit-Reset": {
          description: "Unix timestamp when the window resets.",
          schema: { type: "integer" },
        },
      };
    }
    responses[code] = response;
  }
  for (const [code, extra] of Object.entries(options.extraResponses ?? {})) {
    responses[code] = extra;
  }
  const fragment: {
    responses: OpenAPIV3.ResponsesObject;
    parameters?: OpenAPIV3.ParameterObject[];
  } = { responses };
  if (options.headers) fragment.parameters = options.headers;
  return fragment;
}

/** Envelope `{ name: <Resource> }` helpers for single-resource responses. */
export function envelope(
  properties: Record<string, AnySchema>,
  required: string[] = [],
): Schema {
  return {
    type: "object",
    properties,
    required,
    additionalProperties: true,
  };
}

export const R = ref;
