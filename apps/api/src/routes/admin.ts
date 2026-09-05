import { Elysia, t } from "elysia";
import { roleAssignSchema, roleRevokeSchema } from "@deadline-radar/validation";

import { requireAuthPlugin } from "../plugins/auth";
import {
  assignRole,
  listAuditEvents,
  revokeRole,
} from "../lib/authorization/role-admin";
import {
  ApiError,
  beginIdempotent,
  completeIdempotent,
  jsonBodyDetail,
  openApiBodies,
  pageMeta,
  parsePaginationQuery,
  readIdempotencyKey,
  readJsonBody,
  serializeAuditEvent,
  validationFromZod,
} from "../lib/api";
import { assertNoForbiddenMutationKeys } from "../lib/authorization";

export const adminRoutes = new Elysia({ prefix: "/api/v1/admin" })
  .use(requireAuthPlugin)
  .post(
    "/roles/assign",
    async ({ requireAuthz, request, set }) => {
      const ctx = await requireAuthz("role.assign");
      const body = await readJsonBody(request);
      assertNoForbiddenMutationKeys(body);
      const parsed = roleAssignSchema.safeParse(body);
      if (!parsed.success) {
        throw validationFromZod(
          "Invalid role assignment",
          parsed.error.flatten().fieldErrors,
        );
      }

      const idemKey = readIdempotencyKey(request);
      if (idemKey) {
        const { replay } = await beginIdempotent({
          userId: ctx.subject.id,
          key: idemKey,
          method: "POST",
          path: "/api/v1/admin/roles/assign",
          body: parsed.data,
        });
        if (replay) {
          set.status = replay.statusCode;
          return replay.body;
        }
      }

      const result = await assignRole({
        actorId: ctx.subject.id,
        targetUserId: parsed.data.user_id,
        roleSlug: parsed.data.role_slug,
        request,
      });
      if (!result.ok) {
        if (result.error === "user_not_found") {
          throw ApiError.notFound("User not found");
        }
        if (result.error === "already_assigned") {
          throw ApiError.conflict("Role already assigned");
        }
        throw ApiError.validation("Invalid role");
      }
      const response = {
        ok: true as const,
        userId: result.userId,
        roleSlug: result.roleSlug,
      };
      if (idemKey) {
        await completeIdempotent({
          userId: ctx.subject.id,
          key: idemKey,
          statusCode: 200,
          body: response,
        });
      }
      return response;
    },
    {
      detail: {
        tags: ["Admin"],
        summary: "Assign role to user",
        requestBody: jsonBodyDetail(openApiBodies.roleAssign),
      },
    },
  )
  .post(
    "/roles/revoke",
    async ({ requireAuthz, request }) => {
      const ctx = await requireAuthz("role.revoke");
      const body = await readJsonBody(request);
      assertNoForbiddenMutationKeys(body);
      const parsed = roleRevokeSchema.safeParse(body);
      if (!parsed.success) {
        throw validationFromZod(
          "Invalid role revoke",
          parsed.error.flatten().fieldErrors,
        );
      }
      const result = await revokeRole({
        actorId: ctx.subject.id,
        targetUserId: parsed.data.user_id,
        roleSlug: parsed.data.role_slug,
        request,
      });
      if (!result.ok) {
        if (result.error === "not_assigned") {
          throw ApiError.notFound("Role not assigned");
        }
        throw ApiError.validation("Invalid role");
      }
      return { ok: true, userId: result.userId, roleSlug: result.roleSlug };
    },
    {
      detail: {
        tags: ["Admin"],
        summary: "Revoke role from user",
        requestBody: jsonBodyDetail(openApiBodies.roleAssign),
      },
    },
  )
  .get(
    "/audit",
    async ({ query, requireAuthz }) => {
      await requireAuthz("audit.view");
      const { limit, cursor } = parsePaginationQuery(query);
      const { events, nextCursor } = await listAuditEvents({ limit, cursor });
      return {
        events: events.map(serializeAuditEvent),
        page: pageMeta(limit, nextCursor),
      };
    },
    {
      query: t.Object({
        limit: t.Optional(t.String()),
        cursor: t.Optional(t.String()),
      }),
      detail: { tags: ["Admin"], summary: "List auth audit events" },
    },
  );
