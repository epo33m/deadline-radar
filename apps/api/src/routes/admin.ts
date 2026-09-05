import { Elysia, t } from "elysia";

import { requireAuthPlugin } from "../plugins/auth";
import {
  assignRole,
  listAuditEvents,
  revokeRole,
} from "../lib/authorization/role-admin";

export const adminRoutes = new Elysia({ prefix: "/api/admin" })
  .use(requireAuthPlugin)
  .post(
    "/roles/assign",
    async ({ body, requireAuthz, request, set }) => {
      const ctx = await requireAuthz("role.assign");
      const result = await assignRole({
        actorId: ctx.subject.id,
        targetUserId: body.user_id,
        roleSlug: body.role_slug,
        request,
      });
      if (!result.ok) {
        if (result.error === "user_not_found") {
          set.status = 404;
          return { error: "User not found" };
        }
        if (result.error === "already_assigned") {
          set.status = 409;
          return { error: "Role already assigned" };
        }
        set.status = 400;
        return { error: "Invalid role" };
      }
      return { ok: true, userId: result.userId, roleSlug: result.roleSlug };
    },
    {
      body: t.Object({
        user_id: t.String({ format: "uuid" }),
        role_slug: t.String(),
      }),
      detail: { tags: ["Admin"], summary: "Assign role to user" },
    },
  )
  .post(
    "/roles/revoke",
    async ({ body, requireAuthz, request, set }) => {
      const ctx = await requireAuthz("role.revoke");
      const result = await revokeRole({
        actorId: ctx.subject.id,
        targetUserId: body.user_id,
        roleSlug: body.role_slug,
        request,
      });
      if (!result.ok) {
        if (result.error === "not_assigned") {
          set.status = 404;
          return { error: "Role not assigned" };
        }
        set.status = 400;
        return { error: "Invalid role" };
      }
      return { ok: true, userId: result.userId, roleSlug: result.roleSlug };
    },
    {
      body: t.Object({
        user_id: t.String({ format: "uuid" }),
        role_slug: t.String(),
      }),
      detail: { tags: ["Admin"], summary: "Revoke role from user" },
    },
  )
  .get(
    "/audit",
    async ({ query, requireAuthz }) => {
      await requireAuthz("audit.view");
      const limit = query.limit ? Number(query.limit) : 50;
      const events = await listAuditEvents(Number.isFinite(limit) ? limit : 50);
      return { events };
    },
    {
      query: t.Object({
        limit: t.Optional(t.String()),
      }),
      detail: { tags: ["Admin"], summary: "List auth audit events" },
    },
  );
