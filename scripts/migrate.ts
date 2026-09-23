#!/usr/bin/env bun
/**
 * Authoritative Migration Runner & Verification Tool
 *
 * Uses Supabase CLI native migration engine with `supabase_migrations.schema_migrations`
 * to apply and track migrations deterministically.
 *
 * Commands:
 *   bun run scripts/migrate.ts          # Apply pending migrations
 *   bun run scripts/migrate.ts up       # Apply pending migrations
 *   bun run scripts/migrate.ts status   # List local vs remote migrations
 *   bun run scripts/migrate.ts verify   # Assert zero pending migrations (fails CI if unapplied)
 *   bun run scripts/migrate.ts repair <version> <applied|reverted> # Reconcile history
 */

import { spawnSync } from "node:child_process";
import { readdirSync, existsSync } from "node:fs";
import { resolve } from "node:path";

const rootDir = resolve(import.meta.dir, "..");
const migrationsDir = resolve(rootDir, "supabase/migrations");

function getDatabaseUrl(): string {
  const url = process.env.DATABASE_URL || process.env.DIRECT_URL;
  if (!url) {
    console.error("❌ Error: DATABASE_URL is not set.");
    process.exit(1);
  }
  // If connecting to local postgres without sslmode specified, add sslmode=disable
  if ((url.includes("localhost") || url.includes("127.0.0.1")) && !url.includes("sslmode=")) {
    const separator = url.includes("?") ? "&" : "?";
    return `${url}${separator}sslmode=disable`;
  }
  return url;
}

function runSupabaseCli(args: string[]): { status: number; stdout: string; stderr: string } {
  const result = spawnSync("supabase", args, {
    cwd: rootDir,
    encoding: "utf-8",
    env: {
      ...process.env,
    },
  });

  return {
    status: result.status ?? 1,
    stdout: result.stdout || "",
    stderr: result.stderr || "",
  };
}

export function listMigrations(dbUrl: string): { local: string; remote: string; time?: string }[] {
  const res = runSupabaseCli(["migration", "list", "--db-url", dbUrl, "--output-format", "json"]);
  if (res.status !== 0) {
    throw new Error(`Failed to list migrations: ${res.stderr || res.stdout}`);
  }
  try {
    const raw = res.stdout;
    const jsonStart = raw.indexOf("{");
    const jsonEnd = raw.lastIndexOf("}");
    if (jsonStart === -1 || jsonEnd === -1) {
      throw new Error(`No JSON object found in output: ${raw}`);
    }
    const jsonStr = raw.slice(jsonStart, jsonEnd + 1);
    const parsed = JSON.parse(jsonStr);
    return parsed.migrations || [];
  } catch (err) {
    throw new Error(`Failed to parse migration list JSON output: ${res.stdout} (error: ${err})`);
  }
}

export function applyMigrations(dbUrl: string): void {
  console.log("🚀 Applying pending migrations from supabase/migrations/ ...");
  const res = runSupabaseCli(["migration", "up", "--db-url", dbUrl]);
  if (res.status !== 0) {
    console.error("❌ Migration failed:\n", res.stderr || res.stdout);
    process.exit(1);
  }
  console.log("✅ Migrations applied successfully.\n", res.stdout);
}

export function verifyMigrationsApplied(dbUrl: string): boolean {
  console.log("🔍 Checking for unapplied / pending migrations ...");
  const migrations = listMigrations(dbUrl);
  const unapplied = migrations.filter((m) => !m.remote || m.remote === "");

  if (unapplied.length > 0) {
    console.error("❌ Detected unapplied migrations:");
    for (const m of unapplied) {
      console.error(`  - Version: ${m.local} (local file exists, not applied in remote database)`);
    }
    return false;
  }

  console.log(`✅ All ${migrations.length} local migrations are applied in database history.`);
  return true;
}

export function repairMigration(dbUrl: string, version: string, status: "applied" | "reverted"): void {
  console.log(`🔧 Repairing migration version ${version} -> ${status} ...`);
  const res = runSupabaseCli(["migration", "repair", "--db-url", dbUrl, "--status", status, version]);
  if (res.status !== 0) {
    console.error("❌ Migration repair failed:\n", res.stderr || res.stdout);
    process.exit(1);
  }
  console.log("✅ Migration history repaired successfully.\n", res.stdout);
}

// CLI Execution
if (import.meta.main) {
  const command = process.argv[2] || "up";
  const dbUrl = getDatabaseUrl();

  switch (command) {
    case "up":
    case "migrate":
      applyMigrations(dbUrl);
      break;

    case "status":
    case "list": {
      const list = listMigrations(dbUrl);
      console.table(list);
      break;
    }

    case "verify": {
      const ok = verifyMigrationsApplied(dbUrl);
      if (!ok) {
        process.exit(1);
      }
      break;
    }

    case "repair": {
      const version = process.argv[3];
      const status = process.argv[4] as "applied" | "reverted";
      if (!version || (status !== "applied" && status !== "reverted")) {
        console.error("Usage: bun run scripts/migrate.ts repair <version> <applied|reverted>");
        process.exit(1);
      }
      repairMigration(dbUrl, version, status);
      break;
    }

    default:
      console.error(`Unknown command: ${command}`);
      console.error("Available commands: up, status, verify, repair");
      process.exit(1);
  }
}
