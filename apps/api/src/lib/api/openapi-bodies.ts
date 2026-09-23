/**
 * OpenAPI request-body schemas (documentation only).
 * Runtime validation is Zod via readJsonBody — TypeBox must not parse bodies
 * or it strips unknown fields before .strict() can reject them.
 */

import type { OpenAPIV3 } from "openapi-types";

type Schema = OpenAPIV3.SchemaObject;

function objectSchema(
  properties: Record<string, Schema>,
  required: string[] = [],
): Schema {
  return {
    type: "object",
    properties,
    required,
    additionalProperties: false,
  };
}

const string: Schema = { type: "string" };
const uuid: Schema = { type: "string", format: "uuid" };
const nullableString: Schema = { type: "string", nullable: true };

export const openApiBodies = {
  courseCreate: objectSchema(
    {
      name: string,
      code: nullableString,
      color: nullableString,
      icon: nullableString,
      description: nullableString,
    },
    ["name"],
  ),
  coursePatch: objectSchema({
    name: string,
    code: nullableString,
    color: nullableString,
    icon: nullableString,
    description: nullableString,
    updatedAt: string,
    updated_at: string,
  }),
  taskCreate: objectSchema(
    {
      title: string,
      course_id: uuid,
      deadline: string,
      status: { type: "string", enum: ["todo", "in_progress", "done"] },
      description: nullableString,
    },
    ["title", "course_id", "deadline", "status"],
  ),
  taskPatch: objectSchema({
    title: string,
    course_id: uuid,
    deadline: string,
    status: { type: "string", enum: ["todo", "in_progress", "done"] },
    description: nullableString,
    updatedAt: string,
    updated_at: string,
  }),
  linkAttachment: objectSchema(
    {
      task_id: uuid,
      url: string,
      notes: string,
    },
    ["task_id", "url"],
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
  changePassword: objectSchema(
    {
      currentPassword: string,
      password: string,
      confirmPassword: string,
    },
    ["currentPassword", "password", "confirmPassword"],
  ),
  changeEmail: objectSchema(
    {
      email: string,
      currentPassword: string,
    },
    ["email", "currentPassword"],
  ),
  timezone: objectSchema({ timezone: string }, ["timezone"]),
  timeFormat: objectSchema(
    { timeFormat: { type: "string", enum: ["24h", "12h"] } },
    ["timeFormat"],
  ),
  threshold: objectSchema(
    {
      days_before: {
        type: "number",
        minimum: 0,
        maximum: 36500,
        description: "Whole days before the deadline (numeric strings coerce).",
      },
    },
    ["days_before"],
  ),
  thresholdsPut: objectSchema(
    {
      thresholds: {
        type: "array",
        items: {
          type: "object",
          properties: {
            days_before: {
              type: "number",
              minimum: 0,
              maximum: 36500,
              description:
                "Whole days before the deadline (numeric strings coerce).",
            },
          },
          required: ["days_before"],
          additionalProperties: false,
        },
      },
    },
    ["thresholds"],
  ),
};

export function jsonBodyDetail(
  schema: Schema,
): OpenAPIV3.RequestBodyObject {
  return {
    content: {
      "application/json": { schema },
    },
    required: true,
  };
}