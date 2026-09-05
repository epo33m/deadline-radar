/**
 * OpenAPI request-body schemas (documentation only).
 * Runtime validation is Zod via readJsonBody — TypeBox must not parse bodies
 * or it strips unknown fields before .strict() can reject them.
 */

function objectSchema(
  properties: Record<string, unknown>,
  required: string[] = [],
) {
  return {
    type: "object" as const,
    properties,
    required,
    additionalProperties: false,
  };
}

const string = { type: "string" as const };
const uuid = { type: "string" as const, format: "uuid" };
const nullableString = { type: ["string", "null"] as const };

export const openApiBodies = {
  courseCreate: objectSchema(
    {
      name: string,
      code: nullableString,
      color: nullableString,
    },
    ["name"],
  ),
  coursePatch: objectSchema(
    {
      name: string,
      code: nullableString,
      color: nullableString,
      updatedAt: string,
      updated_at: string,
    },
    ["name"],
  ),
  taskCreate: objectSchema(
    {
      title: string,
      course_id: uuid,
      deadline: string,
      status: { type: "string", enum: ["todo", "in_progress", "done"] },
      description: nullableString,
      estimated_duration: {
        anyOf: [{ type: "number" }, { type: "string" }, { type: "null" }],
      },
    },
    ["title", "course_id", "deadline", "status"],
  ),
  taskPatch: objectSchema(
    {
      title: string,
      course_id: uuid,
      deadline: string,
      status: { type: "string", enum: ["todo", "in_progress", "done"] },
      description: nullableString,
      estimated_duration: {
        anyOf: [{ type: "number" }, { type: "string" }, { type: "null" }],
      },
      updatedAt: string,
      updated_at: string,
    },
    ["title", "course_id", "deadline", "status"],
  ),
  linkAttachment: objectSchema(
    {
      task_id: uuid,
      name: string,
      url: string,
    },
    ["task_id", "name", "url"],
  ),
  roleAssign: objectSchema(
    {
      user_id: uuid,
      role_slug: string,
    },
    ["user_id", "role_slug"],
  ),
  register: objectSchema(
    {
      email: string,
      password: string,
      timezone: string,
    },
    ["email", "password"],
  ),
  login: objectSchema(
    {
      email: string,
      password: string,
    },
    ["email", "password"],
  ),
  forgotPassword: objectSchema({ email: string }, ["email"]),
  resetPassword: objectSchema(
    {
      password: string,
      confirmPassword: string,
    },
    ["password", "confirmPassword"],
  ),
  timezone: objectSchema({ timezone: string }, ["timezone"]),
  threshold: objectSchema({ days_before: { type: "number" } }, ["days_before"]),
} as const;

export function jsonBodyDetail(schema: (typeof openApiBodies)[keyof typeof openApiBodies]) {
  return {
    content: {
      "application/json": { schema },
    },
    required: true,
  };
}
