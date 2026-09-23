import { afterAll, describe, expect, test } from "bun:test";
import { fileURLToPath } from "node:url";
import type { Sql } from "postgres";
import { postgres } from "./client";

function getTestDbUrl(): string {
  if (process.env.TEST_DATABASE_URL) {
    return process.env.TEST_DATABASE_URL;
  }
  const url = process.env.DATABASE_URL;
  if (url && !url.includes("supabase.co") && !url.includes("pooler.supabase.com")) {
    if ((url.includes("localhost") || url.includes("127.0.0.1")) && !url.includes("sslmode=")) {
      const sep = url.includes("?") ? "&" : "?";
      return `${url}${sep}sslmode=disable`;
    }
    return url;
  }
  return "postgresql://localhost:5432/test_verify_all?sslmode=disable";
}

const BUG01_SQL_PATH = fileURLToPath(
  new URL("../../../supabase/tests/bug01_registration_rbac_test.sql", import.meta.url),
);

describe("BUG-01: Registration RBAC & Email Normalization Trigger (DB Verification)", () => {
  const dbUrl = getTestDbUrl();
  const sql: Sql = postgres(dbUrl, {
    prepare: false,
    max: 2,
    connect_timeout: 5,
    onnotice: () => {},
  });

  afterAll(async () => {
    await sql.end();
  });

  test("bug01_registration_rbac_test.sql passes: trigger provisions profile + user role + normalizes email", async () => {
    const reserved = await sql.reserve();
    try {
      await reserved.file(BUG01_SQL_PATH);
    } finally {
      reserved.release();
    }
    expect(true).toBe(true);
  });

  test("Registration flow: auth.users insert -> profile (normalized) -> user_roles ('user')", async () => {
    await sql.begin(async (tx) => {
      const userId = "aaaaaaaa-1111-4111-a111-111111111111";
      const rawEmail = "  Student.Registration@Example.COM  ";
      const expectedNormalizedEmail = "student.registration@example.com";

      // 1. Insert into auth.users (simulating registration)
      await tx`
        INSERT INTO auth.users (id, email, raw_user_meta_data, raw_app_meta_data, created_at, updated_at)
        VALUES (${userId}, ${rawEmail}, '{}'::jsonb, '{}'::jsonb, now(), now())
      `;

      // 2. Assert public.profiles row created with normalized email
      const profiles = await tx`SELECT id, email FROM public.profiles WHERE id = ${userId}`;
      expect(profiles.length).toBe(1);
      expect(profiles[0].email).toBe(expectedNormalizedEmail);

      // 3. Assert public.user_roles row created with 'user' role
      const userRoles = await tx`
        SELECT ur.user_id, r.slug
        FROM public.user_roles ur
        JOIN public.roles r ON ur.role_id = r.id
        WHERE ur.user_id = ${userId}
      `;
      expect(userRoles.length).toBe(1);
      expect(userRoles[0].slug).toBe("user");

      throw new Error("ROLLBACK");
    }).catch((e) => {
      if (e.message !== "ROLLBACK") throw e;
    });
  });

  test("Elevated role preservation: admin role is preserved and not degraded", async () => {
    await sql.begin(async (tx) => {
      const adminId = "bbbbbbbb-2222-4222-b222-222222222222";
      const adminEmail = "admin.sec@example.com";

      // 1. Insert into auth.users
      await tx`
        INSERT INTO auth.users (id, email, raw_user_meta_data, raw_app_meta_data, created_at, updated_at)
        VALUES (${adminId}, ${adminEmail}, '{}'::jsonb, '{}'::jsonb, now(), now())
      `;

      // 2. Assign admin role
      const [adminRole] = await tx`SELECT id FROM public.roles WHERE slug = 'admin'`;
      await tx`
        INSERT INTO public.user_roles (user_id, role_id)
        VALUES (${adminId}, ${adminRole.id})
      `;

      // 3. Verify user has both user and admin roles
      const roles = await tx`
        SELECT r.slug
        FROM public.user_roles ur
        JOIN public.roles r ON ur.role_id = r.id
        WHERE ur.user_id = ${adminId}
        ORDER BY r.slug
      `;
      const slugs = roles.map((r) => r.slug);
      expect(slugs).toContain("user");
      expect(slugs).toContain("admin");

      throw new Error("ROLLBACK");
    }).catch((e) => {
      if (e.message !== "ROLLBACK") throw e;
    });
  });
});
