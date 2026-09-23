process.env.NODE_ENV = "test";
process.env.DATABASE_URL ??=
  process.env.TEST_DATABASE_URL ??
  "postgresql://localhost:5432/test_verify_all?sslmode=disable";

import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import { sql } from "drizzle-orm";
import { createDb } from "@deadline-radar/db";
import { loadAuthorizationContext, setLoadAuthorizationContextOverride } from "./load";
import { isAllowed, hasCapability } from "./decide";
import { DOMAIN_CAPABILITIES, ADMIN_CAPABILITIES } from "./capabilities";
import { resetAuthzCache } from "./cache";

function resolveTestDbUrl(): string {
  if (process.env.TEST_DATABASE_URL) return process.env.TEST_DATABASE_URL;
  const url = process.env.DATABASE_URL;
  if (
    url &&
    !url.includes("supabase.co") &&
    !url.includes("pooler.supabase.com")
  ) {
    if (
      (url.includes("localhost") || url.includes("127.0.0.1")) &&
      !url.includes("sslmode=")
    ) {
      const sep = url.includes("?") ? "&" : "?";
      return `${url}${sep}sslmode=disable`;
    }
    return url;
  }
  return "postgresql://localhost:5432/test_verify_all?sslmode=disable";
}

describe("BUG-01: Registration RBAC Authorization Context Flow (Real DB)", () => {
  const db = createDb(resolveTestDbUrl());

  beforeEach(() => {
    setLoadAuthorizationContextOverride(null);
    resetAuthzCache();
  });

  afterAll(() => {
    setLoadAuthorizationContextOverride(null);
    resetAuthzCache();
  });

  test("New user registration flow -> loads user capabilities -> authorized for course.create", async () => {
    const userId = "cccccccc-3333-4333-c333-333333333333";
    const rawEmail = "  NewUser.Authz@Example.COM  ";
    const normalizedEmail = "newuser.authz@example.com";

    try {
      // 1. Simulate registration in auth.users
      await db.execute(
        sql`INSERT INTO auth.users (id, email, raw_user_meta_data, raw_app_meta_data, created_at, updated_at)
            VALUES (${userId}, ${rawEmail}, '{}'::jsonb, '{}'::jsonb, now(), now())`,
      );

      resetAuthzCache();

      // 2. loadAuthorizationContext against the database for this subject
      const authUser = { id: userId, email: normalizedEmail, sessionId: "sess-new-1" };
      const ctx = await loadAuthorizationContext(authUser, null, { db });

      // 3. Verify roles and capabilities
      expect(ctx.roles).toEqual(["user"]);
      for (const cap of DOMAIN_CAPABILITIES) {
        expect(ctx.capabilities.has(cap)).toBe(true);
      }
      expect(ctx.capabilities.has("role.assign")).toBe(false);
      expect(ctx.capabilities.has("role.revoke")).toBe(false);

      // 4. Verify capability checks: course.create is allowed!
      expect(hasCapability(ctx, "course.create")).toBe(true);
      expect(hasCapability(ctx, "course.view")).toBe(true);
      expect(hasCapability(ctx, "task.create")).toBe(true);
      expect(hasCapability(ctx, "task.view")).toBe(true);
      expect(isAllowed(ctx, "course.create")).toEqual({ allowed: true });

      // 5. Verify admin capabilities are denied
      expect(hasCapability(ctx, "role.assign")).toBe(false);
      expect(hasCapability(ctx, "role.revoke")).toBe(false);
      expect(isAllowed(ctx, "role.assign")).toEqual({
        allowed: false,
        reason: "missing_capability",
      });
    } finally {
      await db.execute(sql`DELETE FROM auth.users WHERE id = ${userId}`);
      resetAuthzCache();
    }
  });

  test("Admin user registration + assignment -> retains admin and user capabilities", async () => {
    const adminId = "dddddddd-4444-4444-d444-444444444444";
    const adminEmail = "admin.authz@example.com";

    try {
      // 1. Register user
      await db.execute(
        sql`INSERT INTO auth.users (id, email, raw_user_meta_data, raw_app_meta_data, created_at, updated_at)
            VALUES (${adminId}, ${adminEmail}, '{}'::jsonb, '{}'::jsonb, now(), now())`,
      );

      // 2. Assign admin role
      const adminRoleRes = (await db.execute(
        sql`SELECT id::text as id FROM public.roles WHERE slug = 'admin' LIMIT 1`,
      )) as unknown as { id: string }[];
      const adminRoleId = adminRoleRes[0]?.id;

      await db.execute(
        sql`INSERT INTO public.user_roles (user_id, role_id)
            VALUES (${adminId}, ${adminRoleId})`,
      );

      resetAuthzCache();

      // 3. loadAuthorizationContext
      const authUser = { id: adminId, email: adminEmail, sessionId: "sess-admin-1" };
      const ctx = await loadAuthorizationContext(authUser, null, { db });

      // 4. Verify roles and capabilities
      expect(ctx.roles).toContain("user");
      expect(ctx.roles).toContain("admin");
      for (const cap of DOMAIN_CAPABILITIES) {
        expect(ctx.capabilities.has(cap)).toBe(true);
      }
      for (const cap of ADMIN_CAPABILITIES) {
        expect(ctx.capabilities.has(cap)).toBe(true);
      }

      // 5. Verify allowed actions
      expect(hasCapability(ctx, "course.create")).toBe(true);
      expect(hasCapability(ctx, "role.assign")).toBe(true);
      expect(hasCapability(ctx, "role.revoke")).toBe(true);
      expect(hasCapability(ctx, "audit.view")).toBe(true);
      expect(isAllowed(ctx, "course.create")).toEqual({ allowed: true });
      expect(isAllowed(ctx, "role.assign")).toEqual({ allowed: true });
    } finally {
      await db.execute(sql`DELETE FROM auth.users WHERE id = ${adminId}`);
      resetAuthzCache();
    }
  });

  test("Orphan user without role -> empty capabilities -> fail closed (403)", async () => {
    const orphanId = "eeeeeeee-5555-4555-e555-555555555555";
    const orphanEmail = "orphan.authz@example.com";

    try {
      // 1. Create user and manually strip user_roles
      await db.execute(
        sql`INSERT INTO auth.users (id, email, raw_user_meta_data, raw_app_meta_data, created_at, updated_at)
            VALUES (${orphanId}, ${orphanEmail}, '{}'::jsonb, '{}'::jsonb, now(), now())`,
      );
      await db.execute(sql`DELETE FROM public.user_roles WHERE user_id = ${orphanId}`);

      resetAuthzCache();

      // 2. loadAuthorizationContext
      const authUser = { id: orphanId, email: orphanEmail, sessionId: "sess-orphan-1" };
      const ctx = await loadAuthorizationContext(authUser, null, { db });

      // 3. Verify fail-closed behavior
      expect(ctx.roles).toEqual([]);
      expect(ctx.capabilities.size).toBe(0);
      expect(hasCapability(ctx, "course.create")).toBe(false);
      expect(hasCapability(ctx, "course.view")).toBe(false);
      expect(isAllowed(ctx, "course.create")).toEqual({
        allowed: false,
        reason: "missing_capability",
      });
    } finally {
      await db.execute(sql`DELETE FROM auth.users WHERE id = ${orphanId}`);
      resetAuthzCache();
    }
  });
});
