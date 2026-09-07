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
        oneOf: [{ type: "number" }, { type: "string" }],
        nullable: true,
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
        oneOf: [{ type: "number" }, { type: "string" }],
        nullable: true,
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
  threshold: objectSchema(
    { days_before: { type: "number" } },
    ["days_before"],
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