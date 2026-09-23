/**
 * ⚠️ WARNING: DRIZZLE IS NOT THE DATABASE MIGRATION AUTHORITY.
 *
 * Authoritative database schema, CHECK constraints, triggers, RLS policies,
 * functions, storage buckets, and migration tracking are managed exclusively
 * by Supabase SQL migrations in `supabase/migrations/` and applied via
 * `supabase migration up` / `bun run db:migrate`.
 *
 * DO NOT RUN `drizzle-kit push` AGAINST PRODUCTION OR STAGING DATABASES.
 * `drizzle-kit push` does not represent DB-native objects (CHECKs,
 * triggers, RLS, functions) and can destructively alter schema invariants.
 */
import { defineConfig } from "drizzle-kit";

export default defineConfig({
  schema: "./src/schema.ts",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DATABASE_URL ?? "",
  },
});

