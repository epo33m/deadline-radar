import { afterAll, describe, expect, test } from "bun:test";
import { postgres } from "./client";
import {
  AUTHORITATIVE_SCHEMA_CONTRACT,
  verifySchemaAgainstContract,
  type SchemaContract,
} from "./schema-contract";

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

describe("M-13 Database Schema & Drift Protection", () => {
  const dbUrl = getTestDbUrl();
  const sql = postgres(dbUrl, { prepare: false, max: 2, connect_timeout: 5 });

  afterAll(async () => {
    await sql.end();
  });

  test("authoritative contract defines all 12 tables and full object graph", () => {
    expect(Object.keys(AUTHORITATIVE_SCHEMA_CONTRACT.tables).length).toBe(12);
    expect(AUTHORITATIVE_SCHEMA_CONTRACT.rlsEnabledTables.length).toBe(12);
    expect(AUTHORITATIVE_SCHEMA_CONTRACT.policies.length).toBe(17);
    expect(AUTHORITATIVE_SCHEMA_CONTRACT.checkConstraints.length).toBe(22);
    expect(AUTHORITATIVE_SCHEMA_CONTRACT.triggers.length).toBe(6);
    expect(AUTHORITATIVE_SCHEMA_CONTRACT.functions.length).toBe(9);
  });

  test("live database schema matches authoritative contract with zero drift", async () => {
    const result = await verifySchemaAgainstContract(sql, AUTHORITATIVE_SCHEMA_CONTRACT);
    if (!result.ok) {
      console.error("Schema drift detected in test:", result.errors);
    }
    expect(result.ok).toBe(true);
    expect(result.errors).toEqual([]);
    expect(result.summary.tablesVerified).toBe(12);
    expect(result.summary.rlsTablesVerified).toBe(12);
    expect(result.summary.policiesVerified).toBe(17);
    expect(result.summary.checkConstraintsVerified).toBe(22);
    expect(result.summary.triggersVerified).toBe(6);
  });

  test("migration history table tracks all 44 migrations", async () => {
    const rows = await sql<{ version: string; name: string }[]>`
      SELECT version, name FROM supabase_migrations.schema_migrations ORDER BY version;
    `;
    expect(rows.length).toBe(44);
    expect(rows[0].version).toBe("20260901000000");
    expect(rows[rows.length - 1].version).toBe("20261007000000");
  });

  describe("drift detector failure cases (adversarial simulation)", () => {
    test("detects missing table", async () => {
      const driftedContract: SchemaContract = {
        ...AUTHORITATIVE_SCHEMA_CONTRACT,
        tables: {
          ...AUTHORITATIVE_SCHEMA_CONTRACT.tables,
          non_existent_table: [{ name: "id", type: "uuid", nullable: false }],
        },
      };
      const res = await verifySchemaAgainstContract(sql, driftedContract);
      expect(res.ok).toBe(false);
      expect(res.errors.some((e) => e.includes('Missing Table: "non_existent_table"'))).toBe(true);
    });

    test("detects column type or nullability drift", async () => {
      const driftedContract: SchemaContract = {
        ...AUTHORITATIVE_SCHEMA_CONTRACT,
        tables: {
          ...AUTHORITATIVE_SCHEMA_CONTRACT.tables,
          courses: [
            ...AUTHORITATIVE_SCHEMA_CONTRACT.tables.courses.filter((c) => c.name !== "name"),
            { name: "name", type: "integer", nullable: true }, // Intentionally wrong type and nullable
          ],
        },
      };
      const res = await verifySchemaAgainstContract(sql, driftedContract);
      expect(res.ok).toBe(false);
      expect(res.errors.some((e) => e.includes('Table "courses" column "name" nullability mismatch'))).toBe(true);
      expect(res.errors.some((e) => e.includes('Table "courses" column "name" type mismatch'))).toBe(true);
    });

    test("detects missing CHECK constraint", async () => {
      const driftedContract: SchemaContract = {
        ...AUTHORITATIVE_SCHEMA_CONTRACT,
        checkConstraints: [
          ...AUTHORITATIVE_SCHEMA_CONTRACT.checkConstraints,
          { table: "tasks", constraintName: "non_existent_check_constraint" },
        ],
      };
      const res = await verifySchemaAgainstContract(sql, driftedContract);
      expect(res.ok).toBe(false);
      expect(
        res.errors.some((e) => e.includes('missing CHECK constraint "non_existent_check_constraint"')),
      ).toBe(true);
    });

    test("detects missing FK constraint or delete rule mismatch", async () => {
      const driftedContract: SchemaContract = {
        ...AUTHORITATIVE_SCHEMA_CONTRACT,
        foreignKeys: [
          ...AUTHORITATIVE_SCHEMA_CONTRACT.foreignKeys.filter(
            (f) => f.constraintName !== "tasks_course_id_user_id_fkey",
          ),
          {
            table: "tasks",
            constraintName: "tasks_course_id_user_id_fkey",
            foreignTable: "courses",
            columns: ["course_id", "user_id"],
            foreignColumns: ["id", "user_id"],
            deleteRule: "SET NULL", // Intentionally wrong delete rule
          },
        ],
      };
      const res = await verifySchemaAgainstContract(sql, driftedContract);
      expect(res.ok).toBe(false);
      expect(res.errors.some((e) => e.includes('FK "tasks_course_id_user_id_fkey" ON DELETE mismatch'))).toBe(
        true,
      );
    });

    test("detects missing or un-configured trigger", async () => {
      const driftedContract: SchemaContract = {
        ...AUTHORITATIVE_SCHEMA_CONTRACT,
        triggers: [
          ...AUTHORITATIVE_SCHEMA_CONTRACT.triggers,
          {
            table: "tasks",
            triggerName: "non_existent_trigger",
            timing: "BEFORE",
            event: "INSERT",
            functionName: "fake_function",
          },
        ],
      };
      const res = await verifySchemaAgainstContract(sql, driftedContract);
      expect(res.ok).toBe(false);
      expect(res.errors.some((e) => e.includes('Table "tasks" missing trigger "non_existent_trigger"'))).toBe(
        true,
      );
    });

    test("detects missing RLS policy", async () => {
      const driftedContract: SchemaContract = {
        ...AUTHORITATIVE_SCHEMA_CONTRACT,
        policies: [
          ...AUTHORITATIVE_SCHEMA_CONTRACT.policies,
          { table: "profiles", policyName: "non_existent_policy", command: "SELECT" },
        ],
      };
      const res = await verifySchemaAgainstContract(sql, driftedContract);
      expect(res.ok).toBe(false);
      expect(
        res.errors.some((e) => e.includes('Table "profiles" missing RLS policy "non_existent_policy"')),
      ).toBe(true);
    });
  });
});
