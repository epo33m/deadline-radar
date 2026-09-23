import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

import * as schema from "./schema";

export { postgres };
export type Database = ReturnType<typeof createDb>;

/**
 * Connection-tune defaults (RF-01: Supabase/network stalls must fail fast,
 * not hang forever).
 *
 * - connect_timeout: seconds to establish a new connection. postgres.js
 *   default is 30s; under a Supabase pgbouncer outage a 30s block per new
 *   connection starves the scheduler.
 * - statement_timeout: Postgres GUC, milliseconds per statement. The cron
 *   batch queries are all index-point lookups; 15s covers pathological
 *   planner/contention without letting a stuck batch pin the pool.
 * - idle_timeout / max_lifetime: seconds. Rotate pooled connections so a
 *   long-lived lambda/hot-standby swap or a dead connection is reclaimed
 *   instead of poisoning the pool for the rest of a long run.
 *
 * Overridable via env (see buildPostgresConfig) so production can tune per
 * workload without a code deploy.
 */
export const DB_DEFAULTS = {
  connectTimeoutSec: 10,
  statementTimeoutMs: 15_000,
  idleTimeoutSec: 30,
  maxLifetimeSec: 30 * 60,
} as const;

export type DbConnectionOptions = {
  /** Seconds; postgres.js connect_timeout (default 10). */
  connectTimeout?: number;
  /** Milliseconds; Postgres statement_timeout GUC (default 15000). */
  statementTimeoutMs?: number;
  /** Seconds; postgres.js idle_timeout (default 30). */
  idleTimeout?: number;
  /** Seconds; postgres.js max_lifetime (default 1800). */
  maxLifetime?: number;
};

export type DbClientConfig = Required<DbConnectionOptions>;

function positiveIntOrEnv(
  value: number | undefined,
  envName: string,
  fallback: number,
): number {
  if (value !== undefined) return value;
  const raw = process.env[envName];
  if (raw === undefined) return fallback;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

/** Resolve the postgres.js connection tune, merging defaults → env → explicit opts. */
export function buildPostgresConfig(options: DbConnectionOptions = {}): DbClientConfig {
  return {
    connectTimeout: positiveIntOrEnv(
      options.connectTimeout,
      "DATABASE_CONNECT_TIMEOUT",
      DB_DEFAULTS.connectTimeoutSec,
    ),
    statementTimeoutMs: positiveIntOrEnv(
      options.statementTimeoutMs,
      "DATABASE_STATEMENT_TIMEOUT_MS",
      DB_DEFAULTS.statementTimeoutMs,
    ),
    idleTimeout: positiveIntOrEnv(
      options.idleTimeout,
      "DATABASE_IDLE_TIMEOUT",
      DB_DEFAULTS.idleTimeoutSec,
    ),
    maxLifetime: positiveIntOrEnv(
      options.maxLifetime,
      "DATABASE_MAX_LIFETIME",
      DB_DEFAULTS.maxLifetimeSec,
    ),
  };
}

export function createDb(
  connectionString: string,
  options: DbConnectionOptions = {},
) {
  const config = buildPostgresConfig(options);
  const client = postgres(connectionString, {
    prepare: false,
    max: 10,
    connect_timeout: config.connectTimeout,
    idle_timeout: config.idleTimeout,
    max_lifetime: config.maxLifetime,
    // statement_timeout is a per-connection Postgres GUC in milliseconds.
    connection: { statement_timeout: config.statementTimeoutMs },
  });
  return drizzle(client, { schema });
}