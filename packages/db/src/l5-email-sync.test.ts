import { afterAll, describe, expect, test } from "bun:test";
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

describe("L-5: Profile Email Immutability & Auth Synchronization", () => {
  const dbUrl = getTestDbUrl();
  const sql = postgres(dbUrl, { prepare: false, max: 2, connect_timeout: 5 });

  afterAll(async () => {
    await sql.end();
  });

  test("Test A: confirmed Auth email change syncs profile", async () => {
    await sql.begin(async (sql) => {
      const userId = "11111111-2222-4333-8444-555555555551";
      const oldEmail = "test-a-old@example.com";
      const newEmail = "test-a-new@example.com";

      // Provision user
      await sql`
        INSERT INTO auth.users (id, email, raw_user_meta_data, raw_app_meta_data, created_at, updated_at)
        VALUES (${userId}, ${oldEmail}, '{}'::jsonb, '{}'::jsonb, now(), now())
      `;

      // Profile should have old email
      const [initialProf] = await sql`SELECT email FROM public.profiles WHERE id = ${userId}`;
      expect(initialProf.email).toBe(oldEmail);

      // Simulate Auth email confirmation updating auth.users.email
      await sql`UPDATE auth.users SET email = ${newEmail} WHERE id = ${userId}`;

      // Profile should be automatically synchronized to new email
      const [syncedProf] = await sql`SELECT email FROM public.profiles WHERE id = ${userId}`;
      expect(syncedProf.email).toBe(newEmail);

      throw new Error("ROLLBACK");
    }).catch((e) => {
      if (e.message !== "ROLLBACK") throw e;
    });
  });

  test("Test B: direct profile email modification is rejected", async () => {
    await sql.begin(async (sql) => {
      const userId = "11111111-2222-4333-8444-555555555552";
      const initialEmail = "test-b@example.com";

      await sql`
        INSERT INTO auth.users (id, email, raw_user_meta_data, raw_app_meta_data, created_at, updated_at)
        VALUES (${userId}, ${initialEmail}, '{}'::jsonb, '{}'::jsonb, now(), now())
      `;

      let errorCaught: Error | null = null;
      try {
        await sql`
          UPDATE public.profiles
          SET email = 'attacker@example.com'
          WHERE id = ${userId}
        `;
      } catch (err) {
        errorCaught = err as Error;
      }

      expect(errorCaught).not.toBeNull();
      expect(errorCaught?.message).toContain(
        "Direct modification of profiles.email is forbidden. Use auth email change workflow.",
      );

      throw new Error("ROLLBACK");
    }).catch((e) => {
      if (e.message !== "ROLLBACK") throw e;
    });
  });

  test("Test C: manually setting the GUC does NOT bypass protection (depth = 1 rejected)", async () => {
    await sql.begin(async (sql) => {
      const userId = "11111111-2222-4333-8444-555555555553";
      const initialEmail = "test-c@example.com";

      await sql`
        INSERT INTO auth.users (id, email, raw_user_meta_data, raw_app_meta_data, created_at, updated_at)
        VALUES (${userId}, ${initialEmail}, '{}'::jsonb, '{}'::jsonb, now(), now())
      `;

      // Attacker attempts to forge the GUC in the current transaction
      await sql`SELECT set_config('app.in_auth_sync', 'true', true)`;

      let errorCaught: Error | null = null;
      try {
        await sql`
          UPDATE public.profiles
          SET email = 'forged-attacker@example.com'
          WHERE id = ${userId}
        `;
      } catch (err) {
        errorCaught = err as Error;
      }

      // Must be rejected because direct update runs at pg_trigger_depth() = 1
      expect(errorCaught).not.toBeNull();
      expect(errorCaught?.message).toContain(
        "Direct modification of profiles.email is forbidden. Use auth email change workflow.",
      );

      throw new Error("ROLLBACK");
    }).catch((e) => {
      if (e.message !== "ROLLBACK") throw e;
    });
  });

  test("Test D: trusted nested synchronization is allowed (GUC=true AND depth > 1)", async () => {
    await sql.begin(async (sql) => {
      const userId = "11111111-2222-4333-8444-555555555554";
      const email1 = "test-d1@example.com";
      const email2 = "test-d2@example.com";

      await sql`
        INSERT INTO auth.users (id, email, raw_user_meta_data, raw_app_meta_data, created_at, updated_at)
        VALUES (${userId}, ${email1}, '{}'::jsonb, '{}'::jsonb, now(), now())
      `;

      // Trigger chain: UPDATE auth.users (depth 1) -> handle_user_email_change() -> UPDATE profiles (depth 2)
      await sql`UPDATE auth.users SET email = ${email2} WHERE id = ${userId}`;

      const [prof] = await sql`SELECT email FROM public.profiles WHERE id = ${userId}`;
      expect(prof.email).toBe(email2);

      throw new Error("ROLLBACK");
    }).catch((e) => {
      if (e.message !== "ROLLBACK") throw e;
    });
  });

  test("Test E: updated_at is updated on profile email sync", async () => {
    await sql.begin(async (sql) => {
      const userId = "11111111-2222-4333-8444-555555555555";
      const email1 = "test-e1@example.com";
      const email2 = "test-e2@example.com";

      // Insert with older timestamp
      await sql`
        INSERT INTO auth.users (id, email, raw_user_meta_data, raw_app_meta_data, created_at, updated_at)
        VALUES (${userId}, ${email1}, '{}'::jsonb, '{}'::jsonb, now() - interval '1 hour', now() - interval '1 hour')
      `;

      await sql`
        UPDATE public.profiles
        SET updated_at = now() - interval '1 hour'
        WHERE id = ${userId}
      `;

      const [beforeProf] = await sql`SELECT updated_at FROM public.profiles WHERE id = ${userId}`;
      const beforeTime = new Date(beforeProf.updated_at).getTime();

      // Trigger sync
      await sql`UPDATE auth.users SET email = ${email2} WHERE id = ${userId}`;

      const [afterProf] = await sql`SELECT updated_at FROM public.profiles WHERE id = ${userId}`;
      const afterTime = new Date(afterProf.updated_at).getTime();

      expect(afterTime).toBeGreaterThan(beforeTime);

      throw new Error("ROLLBACK");
    }).catch((e) => {
      if (e.message !== "ROLLBACK") throw e;
    });
  });

  test("Test F: unchanged email is harmless and does not fail", async () => {
    await sql.begin(async (sql) => {
      const userId = "11111111-2222-4333-8444-555555555556";
      const sameEmail = "test-f@example.com";

      await sql`
        INSERT INTO auth.users (id, email, raw_user_meta_data, raw_app_meta_data, created_at, updated_at)
        VALUES (${userId}, ${sameEmail}, '{}'::jsonb, '{}'::jsonb, now(), now())
      `;

      // Update auth.users with same email (e.g. updating updated_at or metadata)
      await sql`UPDATE auth.users SET updated_at = now() WHERE id = ${userId}`;

      // Update profiles non-email columns (e.g. timezone) directly
      await sql`UPDATE public.profiles SET timezone = 'Asia/Jakarta' WHERE id = ${userId}`;

      const [prof] = await sql`SELECT email, timezone FROM public.profiles WHERE id = ${userId}`;
      expect(prof.email).toBe(sameEmail);
      expect(prof.timezone).toBe("Asia/Jakarta");

      throw new Error("ROLLBACK");
    }).catch((e) => {
      if (e.message !== "ROLLBACK") throw e;
    });
  });

  test("Test G: transaction-local GUC does not leak after transaction", async () => {
    // Run transaction with GUC set
    await sql.begin(async (sql) => {
      await sql`SELECT set_config('app.in_auth_sync', 'true', true)`;
      const [inTx] = await sql`SELECT current_setting('app.in_auth_sync', true) as val`;
      expect(inTx.val).toBe("true");
    });

    // Check on same connection outside transaction
    const [outsideTx] = await sql`SELECT current_setting('app.in_auth_sync', true) as val`;
    expect(outsideTx.val).toBe("");
  });
});
