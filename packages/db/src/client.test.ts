import { afterEach, beforeEach, describe, expect, test } from "bun:test";

import {
  buildPostgresConfig,
  DB_DEFAULTS,
  type DbConnectionOptions,
} from "./client";

const ENV_NAMES = [
  "DATABASE_CONNECT_TIMEOUT",
  "DATABASE_STATEMENT_TIMEOUT_MS",
  "DATABASE_IDLE_TIMEOUT",
  "DATABASE_MAX_LIFETIME",
] as const;

function clearDbEnv(): void {
  for (const name of ENV_NAMES) delete process.env[name];
}

let saved: Record<string, string | undefined>;

beforeEach(() => {
  saved = Object.fromEntries(ENV_NAMES.map((n) => [n, process.env[n]]));
  clearDbEnv();
});

afterEach(() => {
  clearDbEnv();
  for (const [name, value] of Object.entries(saved)) {
    if (value !== undefined) process.env[name] = value;
  }
});

describe("buildPostgresConfig (RF-01 connection hardening)", () => {
  test("defaults apply when neither env nor opts are set", () => {
    const config = buildPostgresConfig();
    expect(config).toEqual({
      connectTimeout: DB_DEFAULTS.connectTimeoutSec,
      statementTimeoutMs: DB_DEFAULTS.statementTimeoutMs,
      idleTimeout: DB_DEFAULTS.idleTimeoutSec,
      maxLifetime: DB_DEFAULTS.maxLifetimeSec,
    });
  });

  test("explicit options win over env; unset options fall back to env", () => {
    process.env.DATABASE_CONNECT_TIMEOUT = "99";
    process.env.DATABASE_STATEMENT_TIMEOUT_MS = "9999";
    process.env.DATABASE_IDLE_TIMEOUT = "44";
    process.env.DATABASE_MAX_LIFETIME = "55";
    const config = buildPostgresConfig({
      connectTimeout: 3,
      statementTimeoutMs: 7_000,
    });
    expect(config.connectTimeout).toBe(3);
    expect(config.statementTimeoutMs).toBe(7_000);
    expect(config.idleTimeout).toBe(44);
    expect(config.maxLifetime).toBe(55);
  });

  test("env overrides defaults when no explicit option is given", () => {
    process.env.DATABASE_CONNECT_TIMEOUT = "5";
    process.env.DATABASE_STATEMENT_TIMEOUT_MS = "20000";
    process.env.DATABASE_IDLE_TIMEOUT = "60";
    process.env.DATABASE_MAX_LIFETIME = "3600";
    expect(buildPostgresConfig()).toEqual({
      connectTimeout: 5,
      statementTimeoutMs: 20_000,
      idleTimeout: 60,
      maxLifetime: 3600,
    });
  });

  test("malformed env values fall back to defaults instead of crashing", () => {
    process.env.DATABASE_CONNECT_TIMEOUT = "abc";
    process.env.DATABASE_STATEMENT_TIMEOUT_MS = "-5";
    process.env.DATABASE_IDLE_TIMEOUT = "0";
    const config = buildPostgresConfig();
    expect(config.connectTimeout).toBe(DB_DEFAULTS.connectTimeoutSec);
    expect(config.statementTimeoutMs).toBe(DB_DEFAULTS.statementTimeoutMs);
    expect(config.idleTimeout).toBe(DB_DEFAULTS.idleTimeoutSec);
  });

  test("zero/negative explicit options are honored verbatim (operator intent)", () => {
    const config = buildPostgresConfig({ idleTimeout: 0 } as DbConnectionOptions);
    expect(config.idleTimeout).toBe(0);
  });
});