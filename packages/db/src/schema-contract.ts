import type { Sql } from "postgres";

/**
 * Authoritative Database Schema Contract for Deadline Radar
 *
 * This contract is the comprehensive specification of all database-level invariants
 * produced by `supabase/migrations/*`. It covers:
 * - Tables and column nullability/types
 * - Custom Enums
 * - Primary Keys
 * - Foreign Keys & Delete Cascade behaviors
 * - Unique constraints
 * - CHECK constraints & business invariants
 * - Composite and partial indexes
 * - Triggers & Functions
 * - Row Level Security (RLS) enabled states
 * - RLS Policies
 */

export interface ExpectedTableColumn {
  name: string;
  type: string;
  nullable: boolean;
}

export interface ExpectedForeignKey {
  table: string;
  constraintName: string;
  foreignTable: string;
  columns: string[];
  foreignColumns: string[];
  deleteRule: "CASCADE" | "SET NULL" | "RESTRICT" | "NO ACTION";
}

export interface ExpectedUniqueConstraint {
  table: string;
  constraintName: string;
  columns: string[];
}

export interface ExpectedCheckConstraint {
  table: string;
  constraintName: string;
}

export interface ExpectedIndex {
  table: string;
  indexName: string;
  isUnique: boolean;
  isPartial: boolean;
}

export interface ExpectedTrigger {
  table: string;
  triggerName: string;
  timing: "BEFORE" | "AFTER";
  event: "INSERT" | "UPDATE" | "DELETE";
  functionName: string;
}

export interface ExpectedPolicy {
  table: string;
  policyName: string;
  command: "SELECT" | "INSERT" | "UPDATE" | "DELETE" | "ALL";
}

export interface SchemaContract {
  enums: Record<string, string[]>;
  tables: Record<string, ExpectedTableColumn[]>;
  primaryKeys: Record<string, string[]>;
  foreignKeys: ExpectedForeignKey[];
  uniqueConstraints: ExpectedUniqueConstraint[];
  checkConstraints: ExpectedCheckConstraint[];
  indexes: ExpectedIndex[];
  triggers: ExpectedTrigger[];
  functions: { name: string; securityDefiner: boolean }[];
  rlsEnabledTables: string[];
  policies: ExpectedPolicy[];
}

export const AUTHORITATIVE_SCHEMA_CONTRACT: SchemaContract = {
  enums: {
    task_status: ["todo", "in_progress", "done"],
    notification_channel: ["email", "in_app"],
    notification_status: ["pending", "sent", "failed", "sending"],
    attachment_type: ["file", "link"],
    time_format: ["24h", "12h"],
  },
  tables: {
    profiles: [
      { name: "id", type: "uuid", nullable: false },
      { name: "email", type: "text", nullable: false },
      { name: "name", type: "text", nullable: true },
      { name: "timezone", type: "text", nullable: false },
      { name: "time_format", type: "USER-DEFINED", nullable: false },
      { name: "created_at", type: "timestamp with time zone", nullable: false },
      { name: "updated_at", type: "timestamp with time zone", nullable: false },
    ],
    courses: [
      { name: "id", type: "uuid", nullable: false },
      { name: "user_id", type: "uuid", nullable: false },
      { name: "name", type: "text", nullable: false },
      { name: "code", type: "text", nullable: true },
      { name: "color", type: "text", nullable: true },
      { name: "icon", type: "text", nullable: true },
      { name: "description", type: "text", nullable: true },
      { name: "created_at", type: "timestamp with time zone", nullable: false },
      { name: "updated_at", type: "timestamp with time zone", nullable: false },
      { name: "deleted_at", type: "timestamp with time zone", nullable: true },
    ],
    tasks: [
      { name: "id", type: "uuid", nullable: false },
      { name: "user_id", type: "uuid", nullable: false },
      { name: "course_id", type: "uuid", nullable: false },
      { name: "title", type: "text", nullable: false },
      { name: "description", type: "text", nullable: true },
      { name: "deadline", type: "timestamp with time zone", nullable: false },
      { name: "status", type: "USER-DEFINED", nullable: false },
      { name: "created_at", type: "timestamp with time zone", nullable: false },
      { name: "updated_at", type: "timestamp with time zone", nullable: false },
      { name: "deadline_updated_at", type: "timestamp with time zone", nullable: false },
      { name: "completed_at", type: "timestamp with time zone", nullable: true },
      { name: "deleted_at", type: "timestamp with time zone", nullable: true },
    ],
    reminder_thresholds: [
      { name: "id", type: "uuid", nullable: false },
      { name: "task_id", type: "uuid", nullable: false },
      { name: "days_before", type: "integer", nullable: false },
      { name: "is_default", type: "boolean", nullable: false },
      { name: "created_at", type: "timestamp with time zone", nullable: false },
      { name: "updated_at", type: "timestamp with time zone", nullable: false },
      { name: "deleted_at", type: "timestamp with time zone", nullable: true },
    ],
    notification_deliveries: [
      { name: "id", type: "uuid", nullable: false },
      { name: "task_id", type: "uuid", nullable: false },
      { name: "threshold_id", type: "uuid", nullable: false },
      { name: "channel", type: "USER-DEFINED", nullable: false },
      { name: "status", type: "USER-DEFINED", nullable: false },
      { name: "retry_count", type: "integer", nullable: false },
      { name: "sent_at", type: "timestamp with time zone", nullable: true },
      { name: "read_at", type: "timestamp with time zone", nullable: true },
      { name: "last_error", type: "text", nullable: true },
      { name: "failed_at", type: "timestamp with time zone", nullable: true },
      { name: "claimed_at", type: "timestamp with time zone", nullable: true },
      { name: "email_snapshot", type: "jsonb", nullable: true },
      { name: "email_idempotency_key", type: "text", nullable: true },
      { name: "created_at", type: "timestamp with time zone", nullable: false },
      { name: "days_before", type: "integer", nullable: false },
    ],
    reminder_runs: [
      { name: "id", type: "uuid", nullable: false },
      { name: "started_at", type: "timestamp with time zone", nullable: false },
      { name: "finished_at", type: "timestamp with time zone", nullable: true },
      { name: "evaluated_tasks", type: "integer", nullable: false },
      { name: "created", type: "integer", nullable: false },
      { name: "retried", type: "integer", nullable: false },
      { name: "emails_sent", type: "integer", nullable: false },
      { name: "emails_failed", type: "integer", nullable: false },
      { name: "emails_skipped_quota", type: "integer", nullable: false },
      { name: "status", type: "text", nullable: false },
      { name: "error", type: "text", nullable: true },
      { name: "last_seen_task_id", type: "uuid", nullable: true },
      { name: "truncated", type: "boolean", nullable: false },
    ],
    attachments: [
      { name: "id", type: "uuid", nullable: false },
      { name: "task_id", type: "uuid", nullable: false },
      { name: "type", type: "USER-DEFINED", nullable: false },
      { name: "storage_path", type: "text", nullable: true },
      { name: "url", type: "text", nullable: true },
      { name: "created_at", type: "timestamp with time zone", nullable: false },
      { name: "notes", type: "text", nullable: true },
    ],
    auth_audit_events: [
      { name: "id", type: "uuid", nullable: false },
      { name: "event", type: "text", nullable: false },
      { name: "user_id", type: "uuid", nullable: true },
      { name: "session_id", type: "text", nullable: true },
      { name: "result", type: "text", nullable: false },
      { name: "method", type: "text", nullable: true },
      { name: "ip", type: "text", nullable: true },
      { name: "user_agent", type: "text", nullable: true },
      { name: "request_id", type: "text", nullable: true },
      { name: "metadata", type: "jsonb", nullable: true },
      { name: "created_at", type: "timestamp with time zone", nullable: false },
    ],
    roles: [
      { name: "id", type: "uuid", nullable: false },
      { name: "slug", type: "text", nullable: false },
      { name: "description", type: "text", nullable: true },
      { name: "created_at", type: "timestamp with time zone", nullable: false },
    ],
    role_capabilities: [
      { name: "id", type: "uuid", nullable: false },
      { name: "role_id", type: "uuid", nullable: false },
      { name: "capability", type: "text", nullable: false },
      { name: "created_at", type: "timestamp with time zone", nullable: false },
    ],
    user_roles: [
      { name: "id", type: "uuid", nullable: false },
      { name: "user_id", type: "uuid", nullable: false },
      { name: "role_id", type: "uuid", nullable: false },
      { name: "assigned_at", type: "timestamp with time zone", nullable: false },
      { name: "assigned_by", type: "uuid", nullable: true },
    ],
    idempotency_keys: [
      { name: "id", type: "uuid", nullable: false },
      { name: "user_id", type: "uuid", nullable: false },
      { name: "key", type: "text", nullable: false },
      { name: "method", type: "text", nullable: false },
      { name: "path", type: "text", nullable: false },
      { name: "request_hash", type: "text", nullable: false },
      { name: "response_status", type: "integer", nullable: true },
      { name: "response_body", type: "jsonb", nullable: true },
      { name: "created_at", type: "timestamp with time zone", nullable: false },
      { name: "expires_at", type: "timestamp with time zone", nullable: false },
    ],
  },
  primaryKeys: {
    profiles: ["id"],
    courses: ["id"],
    tasks: ["id"],
    reminder_thresholds: ["id"],
    notification_deliveries: ["id"],
    attachments: ["id"],
    auth_audit_events: ["id"],
    roles: ["id"],
    role_capabilities: ["id"],
    user_roles: ["id"],
    idempotency_keys: ["id"],
    reminder_runs: ["id"],
  },
  foreignKeys: [
    {
      table: "profiles",
      constraintName: "profiles_id_fkey",
      foreignTable: "users",
      columns: ["id"],
      foreignColumns: ["id"],
      deleteRule: "CASCADE",
    },
    {
      table: "courses",
      constraintName: "courses_user_id_fkey",
      foreignTable: "profiles",
      columns: ["user_id"],
      foreignColumns: ["id"],
      deleteRule: "CASCADE",
    },
    {
      table: "tasks",
      constraintName: "tasks_user_id_fkey",
      foreignTable: "profiles",
      columns: ["user_id"],
      foreignColumns: ["id"],
      deleteRule: "CASCADE",
    },
    {
      table: "tasks",
      constraintName: "tasks_course_id_user_id_fkey",
      foreignTable: "courses",
      columns: ["course_id", "user_id"],
      foreignColumns: ["id", "user_id"],
      deleteRule: "CASCADE",
    },
    {
      table: "reminder_thresholds",
      constraintName: "reminder_thresholds_task_id_fkey",
      foreignTable: "tasks",
      columns: ["task_id"],
      foreignColumns: ["id"],
      deleteRule: "CASCADE",
    },
    {
      table: "notification_deliveries",
      constraintName: "notification_deliveries_task_id_fkey",
      foreignTable: "tasks",
      columns: ["task_id"],
      foreignColumns: ["id"],
      deleteRule: "CASCADE",
    },
    {
      table: "notification_deliveries",
      constraintName: "notification_deliveries_threshold_id_fkey",
      foreignTable: "reminder_thresholds",
      columns: ["threshold_id"],
      foreignColumns: ["id"],
      deleteRule: "CASCADE",
    },
    {
      table: "attachments",
      constraintName: "attachments_task_id_fkey",
      foreignTable: "tasks",
      columns: ["task_id"],
      foreignColumns: ["id"],
      deleteRule: "CASCADE",
    },
    {
      table: "role_capabilities",
      constraintName: "role_capabilities_role_id_fkey",
      foreignTable: "roles",
      columns: ["role_id"],
      foreignColumns: ["id"],
      deleteRule: "CASCADE",
    },
    {
      table: "user_roles",
      constraintName: "user_roles_user_id_fkey",
      foreignTable: "profiles",
      columns: ["user_id"],
      foreignColumns: ["id"],
      deleteRule: "CASCADE",
    },
    {
      table: "user_roles",
      constraintName: "user_roles_role_id_fkey",
      foreignTable: "roles",
      columns: ["role_id"],
      foreignColumns: ["id"],
      deleteRule: "CASCADE",
    },
    {
      table: "user_roles",
      constraintName: "user_roles_assigned_by_fkey",
      foreignTable: "profiles",
      columns: ["assigned_by"],
      foreignColumns: ["id"],
      deleteRule: "SET NULL",
    },
    {
      table: "idempotency_keys",
      constraintName: "idempotency_keys_user_id_fkey",
      foreignTable: "profiles",
      columns: ["user_id"],
      foreignColumns: ["id"],
      deleteRule: "CASCADE",
    },
  ],
  uniqueConstraints: [
    {
      table: "courses",
      constraintName: "courses_id_user_id_key",
      columns: ["id", "user_id"],
    },
    {
      table: "roles",
      constraintName: "roles_slug_key",
      columns: ["slug"],
    },
    {
      table: "role_capabilities",
      constraintName: "role_capabilities_role_id_capability_key",
      columns: ["role_id", "capability"],
    },
    {
      table: "user_roles",
      constraintName: "user_roles_user_id_role_id_key",
      columns: ["user_id", "role_id"],
    },
    {
      table: "notification_deliveries",
      constraintName: "notification_deliveries_threshold_id_days_before_channel_key",
      columns: ["threshold_id", "days_before", "channel"],
    },
    {
      table: "idempotency_keys",
      constraintName: "idempotency_keys_user_id_key_key",
      columns: ["user_id", "key"],
    },
  ],
  checkConstraints: [
    { table: "attachments", constraintName: "attachment_source_check" },
    { table: "attachments", constraintName: "attachments_notes_length_check" },
    { table: "auth_audit_events", constraintName: "auth_audit_events_result_check" },
    { table: "courses", constraintName: "courses_code_length_check" },
    { table: "courses", constraintName: "courses_color_hex_check" },
    { table: "courses", constraintName: "courses_description_length_check" },
    { table: "courses", constraintName: "courses_name_check" },
    { table: "courses", constraintName: "courses_name_length_check" },
    { table: "idempotency_keys", constraintName: "idempotency_keys_key_length_check" },
    { table: "notification_deliveries", constraintName: "notification_deliveries_days_before_check" },
    { table: "notification_deliveries", constraintName: "notification_deliveries_retry_count_check" },
    { table: "profiles", constraintName: "profiles_name_length_check" },
    { table: "profiles", constraintName: "profiles_timezone_valid_check" },
    { table: "reminder_thresholds", constraintName: "reminder_thresholds_days_before_check" },
    { table: "reminder_runs", constraintName: "reminder_runs_status_check" },
    { table: "role_capabilities", constraintName: "role_capabilities_capability_length_check" },
    { table: "roles", constraintName: "roles_description_length_check" },
    { table: "roles", constraintName: "roles_slug_length_check" },
    { table: "tasks", constraintName: "tasks_completed_at_status_check" },
    { table: "tasks", constraintName: "tasks_description_length_check" },
    { table: "tasks", constraintName: "tasks_title_check" },
    { table: "tasks", constraintName: "tasks_title_length_check" },
  ],
  indexes: [
    {
      table: "tasks",
      indexName: "idx_tasks_user_deadline_id_active",
      isUnique: false,
      isPartial: true,
    },
    {
      table: "courses",
      indexName: "idx_courses_user_created_id_active",
      isUnique: false,
      isPartial: true,
    },
    {
      table: "notification_deliveries",
      indexName: "idx_notification_deliveries_in_app_sent",
      isUnique: false,
      isPartial: true,
    },
    {
      table: "attachments",
      indexName: "idx_attachments_task_id",
      isUnique: false,
      isPartial: false,
    },
    {
      table: "attachments",
      indexName: "idx_attachments_storage_path",
      isUnique: false,
      isPartial: true,
    },
    {
      table: "tasks",
      indexName: "idx_tasks_user_course_deadline_active",
      isUnique: false,
      isPartial: true,
    },
    {
      table: "idempotency_keys",
      indexName: "idempotency_keys_expires_at_idx",
      isUnique: false,
      isPartial: false,
    },
    {
      table: "reminder_runs",
      indexName: "idx_reminder_runs_started_at",
      isUnique: false,
      isPartial: false,
    },
    {
      table: "reminder_runs",
      indexName: "reminder_runs_single_active",
      isUnique: true,
      isPartial: true,
    },
    {
      table: "reminder_thresholds",
      indexName: "reminder_thresholds_task_days_before_active_key",
      isUnique: true,
      isPartial: true,
    },
  ],
  triggers: [
    {
      table: "profiles",
      triggerName: "on_profiles_email_immutable",
      timing: "BEFORE",
      event: "UPDATE",
      functionName: "enforce_profile_email_immutable",
    },
    {
      table: "tasks",
      triggerName: "on_task_created",
      timing: "AFTER",
      event: "INSERT",
      functionName: "generate_default_thresholds",
    },
    {
      table: "tasks",
      triggerName: "task_quota_before_insert",
      timing: "BEFORE",
      event: "INSERT",
      functionName: "enforce_task_quota",
    },
    {
      table: "reminder_thresholds",
      triggerName: "threshold_quota_before_insert",
      timing: "BEFORE",
      event: "INSERT",
      functionName: "enforce_threshold_quota",
    },
    {
      table: "notification_deliveries",
      triggerName: "notification_deliveries_read_at_only",
      timing: "BEFORE",
      event: "UPDATE",
      functionName: "enforce_delivery_read_at_only",
    },
    {
      table: "reminder_thresholds",
      triggerName: "threshold_forbid_delete",
      timing: "BEFORE",
      event: "DELETE",
      functionName: "forbid_threshold_delete",
    },
  ],
  functions: [
    { name: "enforce_delivery_read_at_only", securityDefiner: false },
    { name: "enforce_profile_email_immutable", securityDefiner: true },
    { name: "enforce_task_quota", securityDefiner: false },
    { name: "enforce_threshold_quota", securityDefiner: false },
    { name: "forbid_threshold_delete", securityDefiner: false },
    { name: "generate_default_thresholds", securityDefiner: true },
    { name: "handle_new_user", securityDefiner: true },
    { name: "handle_user_email_change", securityDefiner: true },
    { name: "is_valid_timezone", securityDefiner: false },
  ],
  rlsEnabledTables: [
    "profiles",
    "courses",
    "tasks",
    "reminder_thresholds",
    "notification_deliveries",
    "attachments",
    "auth_audit_events",
    "roles",
    "role_capabilities",
    "user_roles",
    "idempotency_keys",
    "reminder_runs",
  ],
  policies: [
    { table: "profiles", policyName: "profiles_select_own", command: "SELECT" },
    { table: "profiles", policyName: "profiles_update_own", command: "UPDATE" },
    { table: "courses", policyName: "courses_select_own", command: "SELECT" },
    { table: "courses", policyName: "courses_insert_own", command: "INSERT" },
    { table: "courses", policyName: "courses_update_own", command: "UPDATE" },
    { table: "tasks", policyName: "tasks_select_own", command: "SELECT" },
    { table: "tasks", policyName: "tasks_insert_own", command: "INSERT" },
    { table: "tasks", policyName: "tasks_update_own", command: "UPDATE" },
    { table: "reminder_thresholds", policyName: "thresholds_select_own", command: "SELECT" },
    { table: "reminder_thresholds", policyName: "thresholds_insert_own", command: "INSERT" },
    { table: "reminder_thresholds", policyName: "thresholds_update_own", command: "UPDATE" },
    { table: "notification_deliveries", policyName: "deliveries_select_own", command: "SELECT" },
    { table: "notification_deliveries", policyName: "deliveries_update_read_own", command: "UPDATE" },
    { table: "attachments", policyName: "attachments_select_own", command: "SELECT" },
    { table: "attachments", policyName: "attachments_insert_own", command: "INSERT" },
    { table: "attachments", policyName: "attachments_update_own", command: "UPDATE" },
    { table: "attachments", policyName: "attachments_delete_own", command: "DELETE" },
  ],
};

export interface VerificationResult {
  ok: boolean;
  errors: string[];
  summary: {
    tablesVerified: number;
    columnsVerified: number;
    enumsVerified: number;
    primaryKeysVerified: number;
    foreignKeysVerified: number;
    uniqueConstraintsVerified: number;
    checkConstraintsVerified: number;
    indexesVerified: number;
    triggersVerified: number;
    functionsVerified: number;
    rlsTablesVerified: number;
    policiesVerified: number;
  };
}

export async function verifySchemaAgainstContract(
  sql: Sql,
  contract: SchemaContract = AUTHORITATIVE_SCHEMA_CONTRACT,
): Promise<VerificationResult> {
  const errors: string[] = [];
  const summary = {
    tablesVerified: 0,
    columnsVerified: 0,
    enumsVerified: 0,
    primaryKeysVerified: 0,
    foreignKeysVerified: 0,
    uniqueConstraintsVerified: 0,
    checkConstraintsVerified: 0,
    indexesVerified: 0,
    triggersVerified: 0,
    functionsVerified: 0,
    rlsTablesVerified: 0,
    policiesVerified: 0,
  };

  // 1. Verify ENUMs
  const dbEnums = await sql<{ typname: string; enumlabel: string }[]>`
    SELECT t.typname, e.enumlabel
    FROM pg_type t
    JOIN pg_enum e ON t.oid = e.enumtypid
    JOIN pg_namespace n ON t.typnamespace = n.oid
    WHERE n.nspname = 'public'
    ORDER BY t.typname, e.enumsortorder;
  `;
  const enumMap = new Map<string, string[]>();
  for (const row of dbEnums) {
    const list = enumMap.get(row.typname) ?? [];
    list.push(row.enumlabel);
    enumMap.set(row.typname, list);
  }

  for (const [enumName, expectedValues] of Object.entries(contract.enums)) {
    const actual = enumMap.get(enumName);
    if (!actual) {
      errors.push(`Missing ENUM type: "${enumName}"`);
    } else {
      const match = JSON.stringify(actual) === JSON.stringify(expectedValues);
      if (!match) {
        errors.push(
          `ENUM "${enumName}" values mismatch. Expected [${expectedValues.join(", ")}], got [${actual.join(", ")}]`,
        );
      } else {
        summary.enumsVerified++;
      }
    }
  }

  // 2. Verify Tables and Columns
  const dbColumns = await sql<{ table_name: string; column_name: string; data_type: string; is_nullable: string }[]>`
    SELECT table_name, column_name, data_type, is_nullable
    FROM information_schema.columns
    WHERE table_schema = 'public'
    ORDER BY table_name, ordinal_position;
  `;
  const tableColumnMap = new Map<string, Map<string, { type: string; nullable: boolean }>>();
  for (const col of dbColumns) {
    let cols = tableColumnMap.get(col.table_name);
    if (!cols) {
      cols = new Map();
      tableColumnMap.set(col.table_name, cols);
    }
    cols.set(col.column_name, {
      type: col.data_type,
      nullable: col.is_nullable === "YES",
    });
  }

  for (const [tableName, expectedCols] of Object.entries(contract.tables)) {
    const actualCols = tableColumnMap.get(tableName);
    if (!actualCols) {
      errors.push(`Missing Table: "${tableName}"`);
      continue;
    }
    summary.tablesVerified++;

    for (const expCol of expectedCols) {
      const actCol = actualCols.get(expCol.name);
      if (!actCol) {
        errors.push(`Table "${tableName}" missing column "${expCol.name}"`);
      } else {
        if (actCol.nullable !== expCol.nullable) {
          errors.push(
            `Table "${tableName}" column "${expCol.name}" nullability mismatch. Expected nullable=${expCol.nullable}, got ${actCol.nullable}`,
          );
        }
        if (actCol.type !== expCol.type) {
          errors.push(
            `Table "${tableName}" column "${expCol.name}" type mismatch. Expected "${expCol.type}", got "${actCol.type}"`,
          );
        }
        summary.columnsVerified++;
      }
    }
  }

  // 3. Verify Primary Keys
  const dbPks = await sql<{ table_name: string; column_name: string }[]>`
    SELECT tc.table_name, kcu.column_name
    FROM information_schema.table_constraints tc
    JOIN information_schema.key_column_usage kcu
      ON tc.constraint_name = kcu.constraint_name AND tc.table_schema = kcu.table_schema
    WHERE tc.table_schema = 'public' AND tc.constraint_type = 'PRIMARY KEY'
    ORDER BY tc.table_name, kcu.ordinal_position;
  `;
  const pkMap = new Map<string, string[]>();
  for (const row of dbPks) {
    const list = pkMap.get(row.table_name) ?? [];
    list.push(row.column_name);
    pkMap.set(row.table_name, list);
  }

  for (const [tableName, expectedPkCols] of Object.entries(contract.primaryKeys)) {
    const actPk = pkMap.get(tableName);
    if (!actPk || JSON.stringify(actPk) !== JSON.stringify(expectedPkCols)) {
      errors.push(
        `Table "${tableName}" primary key mismatch. Expected [${expectedPkCols.join(", ")}], got [${actPk ? actPk.join(", ") : "none"}]`,
      );
    } else {
      summary.primaryKeysVerified++;
    }
  }

  // 4. Verify Foreign Keys
  const dbFks = await sql<{
    table_name: string;
    constraint_name: string;
    foreign_table_name: string;
    delete_rule: string;
  }[]>`
    SELECT
      cl.relname AS table_name,
      con.conname AS constraint_name,
      fcl.relname AS foreign_table_name,
      CASE con.confdeltype
        WHEN 'c' THEN 'CASCADE'
        WHEN 'n' THEN 'SET NULL'
        WHEN 'd' THEN 'SET DEFAULT'
        WHEN 'r' THEN 'RESTRICT'
        WHEN 'a' THEN 'NO ACTION'
      END AS delete_rule
    FROM pg_constraint con
    JOIN pg_class cl ON cl.oid = con.conrelid
    JOIN pg_namespace ns ON ns.oid = cl.relnamespace
    JOIN pg_class fcl ON fcl.oid = con.confrelid
    WHERE con.contype = 'f' AND ns.nspname = 'public'
    ORDER BY cl.relname, con.conname;
  `;
  const fkMap = new Map<string, { foreignTable: string; deleteRule: string }>();
  for (const fk of dbFks) {
    fkMap.set(fk.constraint_name, {
      foreignTable: fk.foreign_table_name,
      deleteRule: fk.delete_rule,
    });
  }

  for (const expFk of contract.foreignKeys) {
    const actFk = fkMap.get(expFk.constraintName);
    if (!actFk) {
      errors.push(
        `Table "${expFk.table}" missing FK constraint "${expFk.constraintName}" -> "${expFk.foreignTable}"`,
      );
    } else if (actFk.deleteRule !== expFk.deleteRule) {
      errors.push(
        `FK "${expFk.constraintName}" ON DELETE mismatch. Expected "${expFk.deleteRule}", got "${actFk.deleteRule}"`,
      );
    } else {
      summary.foreignKeysVerified++;
    }
  }

  // 5. Verify Unique Constraints
  const dbUniques = await sql<{ table_name: string; constraint_name: string }[]>`
    SELECT tc.table_name, tc.constraint_name
    FROM information_schema.table_constraints tc
    WHERE tc.table_schema = 'public' AND tc.constraint_type = 'UNIQUE'
    ORDER BY tc.table_name, tc.constraint_name;
  `;
  const uniqueSet = new Set(dbUniques.map((u) => u.constraint_name));

  for (const expU of contract.uniqueConstraints) {
    if (!uniqueSet.has(expU.constraintName)) {
      errors.push(`Table "${expU.table}" missing UNIQUE constraint "${expU.constraintName}"`);
    } else {
      summary.uniqueConstraintsVerified++;
    }
  }

  // 6. Verify CHECK Constraints
  const dbChecks = await sql<{ table_name: string; constraint_name: string }[]>`
    SELECT tc.table_name, tc.constraint_name
    FROM information_schema.table_constraints tc
    WHERE tc.table_schema = 'public' AND tc.constraint_type = 'CHECK'
    ORDER BY tc.table_name, tc.constraint_name;
  `;
  const checkSet = new Set(dbChecks.map((c) => c.constraint_name));

  for (const expChk of contract.checkConstraints) {
    if (!checkSet.has(expChk.constraintName)) {
      errors.push(`Table "${expChk.table}" missing CHECK constraint "${expChk.constraintName}"`);
    } else {
      summary.checkConstraintsVerified++;
    }
  }

  // 7. Verify Indexes
  const dbIndexes = await sql<{ tablename: string; indexname: string; indexdef: string }[]>`
    SELECT tablename, indexname, indexdef
    FROM pg_indexes
    WHERE schemaname = 'public'
    ORDER BY tablename, indexname;
  `;
  const indexMap = new Map<string, string>();
  for (const idx of dbIndexes) {
    indexMap.set(idx.indexname, idx.indexdef);
  }

  for (const expIdx of contract.indexes) {
    const def = indexMap.get(expIdx.indexName);
    if (!def) {
      errors.push(`Table "${expIdx.table}" missing index "${expIdx.indexName}"`);
    } else {
      if (expIdx.isPartial && !def.toLowerCase().includes("where")) {
        errors.push(`Index "${expIdx.indexName}" is expected to be partial (WHERE clause missing in def: ${def})`);
      } else {
        summary.indexesVerified++;
      }
    }
  }

  // 8. Verify Triggers
  const dbTriggers = await sql<{
    event_object_table: string;
    trigger_name: string;
    action_timing: string;
    event_manipulation: string;
    action_statement: string;
  }[]>`
    SELECT event_object_table, trigger_name, action_timing, event_manipulation, action_statement
    FROM information_schema.triggers
    WHERE trigger_schema = 'public'
    ORDER BY event_object_table, trigger_name;
  `;
  const triggerMap = new Map<string, { timing: string; event: string; stmt: string }>();
  for (const tr of dbTriggers) {
    triggerMap.set(tr.trigger_name, {
      timing: tr.action_timing,
      event: tr.event_manipulation,
      stmt: tr.action_statement,
    });
  }

  for (const expTr of contract.triggers) {
    const actTr = triggerMap.get(expTr.triggerName);
    if (!actTr) {
      errors.push(`Table "${expTr.table}" missing trigger "${expTr.triggerName}"`);
    } else {
      if (actTr.timing !== expTr.timing || actTr.event !== expTr.event) {
        errors.push(
          `Trigger "${expTr.triggerName}" event mismatch. Expected ${expTr.timing} ${expTr.event}, got ${actTr.timing} ${actTr.event}`,
        );
      } else if (!actTr.stmt.includes(expTr.functionName)) {
        errors.push(
          `Trigger "${expTr.triggerName}" executes wrong function. Expected ${expTr.functionName}, got statement: ${actTr.stmt}`,
        );
      } else {
        summary.triggersVerified++;
      }
    }
  }

  // 9. Verify Functions
  const dbFunctions = await sql<{ routine_name: string; security_type: string }[]>`
    SELECT routine_name, security_type
    FROM information_schema.routines
    WHERE routine_schema = 'public'
    ORDER BY routine_name;
  `;
  const fnMap = new Map<string, string>();
  for (const fn of dbFunctions) {
    fnMap.set(fn.routine_name, fn.security_type);
  }

  for (const expFn of contract.functions) {
    const secType = fnMap.get(expFn.name);
    if (!secType) {
      errors.push(`Missing DB function "${expFn.name}"`);
    } else {
      const expSecType = expFn.securityDefiner ? "DEFINER" : "INVOKER";
      if (secType !== expSecType) {
        errors.push(
          `Function "${expFn.name}" security type mismatch. Expected ${expSecType}, got ${secType}`,
        );
      } else {
        summary.functionsVerified++;
      }
    }
  }

  // 10. Verify RLS Enabled State
  const dbRls = await sql<{ relname: string; relrowsecurity: boolean }[]>`
    SELECT c.relname, c.relrowsecurity
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relkind = 'r'
    ORDER BY c.relname;
  `;
  const rlsMap = new Map<string, boolean>();
  for (const r of dbRls) {
    rlsMap.set(r.relname, r.relrowsecurity);
  }

  for (const tbl of contract.rlsEnabledTables) {
    const isEnabled = rlsMap.get(tbl);
    if (isEnabled === undefined) {
      errors.push(`Table "${tbl}" not found for RLS check`);
    } else if (!isEnabled) {
      errors.push(`Table "${tbl}" does NOT have Row Level Security enabled (relrowsecurity = false)`);
    } else {
      summary.rlsTablesVerified++;
    }
  }

  // 11. Verify RLS Policies
  const dbPolicies = await sql<{ tablename: string; policyname: string; cmd: string }[]>`
    SELECT tablename, policyname, cmd
    FROM pg_policies
    WHERE schemaname = 'public'
    ORDER BY tablename, policyname;
  `;
  const policyMap = new Map<string, string>();
  for (const pol of dbPolicies) {
    policyMap.set(`${pol.tablename}.${pol.policyname}`, pol.cmd);
  }

  for (const expPol of contract.policies) {
    const key = `${expPol.table}.${expPol.policyName}`;
    const cmd = policyMap.get(key);
    if (!cmd) {
      errors.push(`Table "${expPol.table}" missing RLS policy "${expPol.policyName}"`);
    } else if (cmd !== expPol.command && cmd !== "*") {
      errors.push(
        `RLS Policy "${expPol.policyName}" on "${expPol.table}" command mismatch. Expected ${expPol.command}, got ${cmd}`,
      );
    } else {
      summary.policiesVerified++;
    }
  }

  return {
    ok: errors.length === 0,
    errors,
    summary,
  };
}
