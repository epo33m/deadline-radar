import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import {
  applyRunnerEnv,
  E2ETargetError,
  parseEnvFile,
  resolveTarget,
  targetEnv,
} from "./target";

/**
 * The E2E suite writes rows, runs the reminder scheduler in-process, and
 * deletes real auth users, and the root `.env.local` points at production. So
 * every way of getting to production has to fail loudly, and the non-prod
 * path has to be reachable by naming one variable.
 *
 * The production values below are the real identifiers from `.env.production`
 * (public hostnames and the Supabase project ref) with fake credentials.
 */

const PROD_DB_URL =
  "postgresql://postgres.bhtfkuzsdxrdmvvcczse:not-a-real-password@aws-0-us-east-1.pooler.supabase.com:6543/postgres";
const PROD_SUPABASE_URL = "https://bhtfkuzsdxrdmvvcczse.supabase.co";
const PROD_WEB_ORIGIN = "https://dr.rapm.space";
const PROD_API_ORIGIN = "https://deadline-radar-api-production.up.railway.app";

const NON_PROD_DB_URL =
  "postgresql://postgres.notprod1234567890ab:not-a-real-password@db.notprod1234567890ab.supabase.co:5432/postgres";
const NON_PROD_SUPABASE_URL = "https://notprod1234567890ab.supabase.co";

let dir: string;

function writeEnvFile(name: string, entries: Record<string, string>): void {
  const body = Object.entries(entries)
    .map(([key, value]) => `${key}=${value}`)
    .join("\n");
  writeFileSync(path.join(dir, name), `${body}\n`, "utf8");
}

function nonProdEnv(overrides: Record<string, string> = {}): Record<string, string> {
  return {
    DATABASE_URL: NON_PROD_DB_URL,
    SUPABASE_URL: NON_PROD_SUPABASE_URL,
    SUPABASE_ANON_KEY: "anon-not-a-real-key",
    SUPABASE_SERVICE_ROLE_KEY: "service-not-a-real-key",
    AUTH_BRIDGE_SECRET: "bridge-not-a-real-secret",
    CRON_SECRET: "cron-not-a-real-secret",
    WEB_ORIGIN: "http://127.0.0.1:3025",
    API_ORIGIN: "http://127.0.0.1:4025",
    API_PORT: "4025",
    ...overrides,
  };
}

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), "e2e-target-"));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("resolveTarget: the suite must be told where to run", () => {
  test("refuses when E2E_TARGET is missing and names the variable", () => {
    writeEnvFile(".env.staging", nonProdEnv());

    let message = "";
    try {
      resolveTarget({ env: {}, root: dir });
    } catch (error) {
      message = (error as Error).message;
    }

    expect(message).toContain("E2E_TARGET is not set");
    expect(message).toContain("E2E_TARGET=staging");
    // The operator should see where the named target would have pointed.
    expect(message).toContain("http://127.0.0.1:3025");
  });

  test("refuses when E2E_TARGET is an unknown name and lists the valid ones", () => {
    writeEnvFile(".env.staging", nonProdEnv());

    let error: unknown;
    try {
      resolveTarget({ env: { E2E_TARGET: "production" }, root: dir });
    } catch (caught) {
      error = caught;
    }

    expect(error).toBeInstanceOf(E2ETargetError);
    expect((error as Error).message).toContain("E2E_TARGET=production is not a valid E2E target");
    expect((error as Error).message).toContain("E2E_TARGET=staging");
  });

  test("refuses when the target's env file is absent, naming the file", () => {
    let message = "";
    try {
      resolveTarget({ env: { E2E_TARGET: "staging" }, root: dir });
    } catch (error) {
      message = (error as Error).message;
    }

    expect(message).toContain(".env.staging");
    expect(message).toContain("setup-staging-project.sh");
  });
});

describe("resolveTarget: production is refused and the resolved host is printed", () => {
  const cases: [string, Record<string, string>, string][] = [
    ["DATABASE_URL", { DATABASE_URL: PROD_DB_URL }, "bhtfkuzsdxrdmvvcczse"],
    ["SUPABASE_URL", { SUPABASE_URL: PROD_SUPABASE_URL }, "bhtfkuzsdxrdmvvcczse"],
    [
      "NEXT_PUBLIC_SUPABASE_URL",
      { NEXT_PUBLIC_SUPABASE_URL: PROD_SUPABASE_URL },
      "bhtfkuzsdxrdmvvcczse",
    ],
    ["WEB_ORIGIN", { WEB_ORIGIN: PROD_WEB_ORIGIN }, "dr.rapm.space"],
    ["API_ORIGIN", { API_ORIGIN: PROD_API_ORIGIN }, "deadline-radar-api-production.up.railway.app"],
  ];

  for (const [key, override, marker] of cases) {
    test(`refuses a target whose ${key} points at production`, () => {
      writeEnvFile(".env.staging", nonProdEnv(override));

      let message = "";
      try {
        resolveTarget({ env: { E2E_TARGET: "staging" }, root: dir });
      } catch (error) {
        message = (error as Error).message;
      }

      expect(message).toContain("resolves to production");
      expect(message).toContain(key);
      // The resolved value is printed so the mistake is obvious.
      expect(message).toContain(override[key] as string);
      expect(message).toContain(marker);
    });
  }

  test("the root .env.local is never a source, even beside the target's own file", () => {
    // The old config loaded this file unconditionally; the suite reached
    // production without anyone naming a target.
    writeEnvFile(".env.local", {
      DATABASE_URL: PROD_DB_URL,
      SUPABASE_URL: PROD_SUPABASE_URL,
      WEB_ORIGIN: PROD_WEB_ORIGIN,
      API_ORIGIN: PROD_API_ORIGIN,
      CRON_SECRET: "prod-cron-secret",
    });
    writeEnvFile(".env.staging", nonProdEnv());

    const target = resolveTarget({ env: { E2E_TARGET: "staging" }, root: dir });

    expect(target.env.DATABASE_URL).toBe(NON_PROD_DB_URL);
    expect(target.env.CRON_SECRET).toBe("cron-not-a-real-secret");
    const everything = JSON.stringify(target);
    expect(everything).not.toContain("bhtfkuzsdxrdmvvcczse");
    expect(everything).not.toContain("vercel.app");
    expect(everything).not.toContain("up.railway.app");
  });

  test("the staging target resolves and carries the target's origins", () => {
    writeEnvFile(".env.staging", nonProdEnv());

    const target = resolveTarget({ env: { E2E_TARGET: "staging" }, root: dir });

    expect(target.name).toBe("staging");
    expect(target.envFile).toBe(".env.staging");
    expect(target.webOrigin).toBe("http://127.0.0.1:3025");
    expect(target.apiOrigin).toBe("http://127.0.0.1:4025");
    expect(target.webPort).toBe(3025);
    expect(target.apiPort).toBe(4025);
    expect(target.env.SUPABASE_ANON_KEY).toBe("anon-not-a-real-key");
  });
});

describe("targetEnv: only the chosen target's variables", () => {
  function resolveNonProd(): ReturnType<typeof resolveTarget> {
    writeEnvFile(".env.staging", nonProdEnv({ NODE_ENV: "production", E2E_WEB_ORIGIN: "http://elsewhere" }));
    return resolveTarget({ env: { E2E_TARGET: "staging" }, root: dir });
  }

  test("carries the target's variables and the host passthrough, nothing else", () => {
    const target = resolveNonProd();

    const env = targetEnv(target, {
      PATH: "/usr/bin",
      HOME: "/home/dev",
      TZ: "Asia/Jakarta",
      CI: "true",
      DATABASE_URL: "from-the-shell-not-the-target",
      SUPABASE_SERVICE_ROLE_KEY: "from-the-shell-not-the-target",
      RANDOM_SHELL_VARIABLE: "must-not-travel",
    });

    expect(env.PATH).toBe("/usr/bin");
    expect(env.HOME).toBe("/home/dev");
    expect(env.TZ).toBe("Asia/Jakarta");
    expect(env.CI).toBe("true");
    expect(env.SUPABASE_ANON_KEY).toBe("anon-not-a-real-key");
    // Shell values never displace the target's.
    expect(env.DATABASE_URL).toBe(NON_PROD_DB_URL);
    expect(env.RANDOM_SHELL_VARIABLE).toBeUndefined();
  });

  test("drops NODE_ENV so the API's fail-closed gate cannot be armed by a stray shell value", () => {
    const target = resolveNonProd();

    // The env file declares NODE_ENV=production; a stray shell value must not
    // be able to add it either.
    expect(targetEnv(target, { NODE_ENV: "production" }).NODE_ENV).toBeUndefined();
  });

  test("drops the E2E_* overrides the old config honoured", () => {
    const target = resolveNonProd();

    const env = targetEnv(target, {
      E2E_WEB_ORIGIN: "http://elsewhere",
      E2E_API_ORIGIN: "http://elsewhere",
      E2E_WEB_PORT: "9999",
    });

    expect(env.E2E_WEB_ORIGIN).toBeUndefined();
    expect(env.E2E_API_ORIGIN).toBeUndefined();
    expect(env.E2E_WEB_PORT).toBeUndefined();
  });

  test("keeps E2E_TARGET so every worker can re-resolve its own target", () => {
    // Playwright re-imports playwright.config.ts inside each worker, and each
    // worker resolves the target again. If applyRunnerEnv drops E2E_TARGET the
    // workers refuse to start and the whole run dies on test #1.
    const target = resolveNonProd();

    const first = targetEnv(target, { E2E_TARGET: "staging" });
    expect(first.E2E_TARGET).toBe("staging");

    // A worker's re-resolution is fed the runner's own environment, and must
    // reach the same target.
    const second = resolveTarget({ env: first, root: dir });
    expect(second.name).toBe("staging");
    expect(second.webOrigin).toBe("http://127.0.0.1:3025");
  });

  test("re-asserts E2E_TARGET rather than trusting a shell value", () => {
    const target = resolveNonProd();

    const env = targetEnv(target, { E2E_TARGET: "production" });

    expect(env.E2E_TARGET).toBe("staging");
  });

  test("the target decides the origins, not the env file", () => {
    writeEnvFile(".env.staging", nonProdEnv({ WEB_ORIGIN: "http://stale", API_ORIGIN: "http://stale" }));
    const target = resolveTarget({ env: { E2E_TARGET: "staging" }, root: dir });

    const env = targetEnv(target, {});

    expect(env.API_ORIGIN).toBe("http://127.0.0.1:4025");
    expect(env.WEB_ORIGIN).toBe("http://127.0.0.1:3025");
    expect(env.API_PORT).toBe("4025");
  });
});

describe("applyRunnerEnv: the runner environment is the boundary", () => {
  test("narrows process.env to the target, and the specs still see their variables", () => {
    writeEnvFile(".env.staging", nonProdEnv());
    const target = resolveTarget({ env: { E2E_TARGET: "staging" }, root: dir });

    const before = { ...process.env };
    process.env.E2E_WEB_ORIGIN = "http://from-the-shell";
    process.env.NOT_A_TARGET_VARIABLE = "must-not-survive";
    try {
      applyRunnerEnv(target, process.env);

      // The specs read these straight off process.env.
      expect(process.env.DATABASE_URL).toBe(NON_PROD_DB_URL);
      expect(process.env.SUPABASE_URL).toBe(NON_PROD_SUPABASE_URL);
      expect(process.env.SUPABASE_SERVICE_ROLE_KEY).toBe("service-not-a-real-key");
      expect(process.env.CRON_SECRET).toBe("cron-not-a-real-secret");
      expect(process.env.API_ORIGIN).toBe("http://127.0.0.1:4025");
      // fixtures.ts prefers E2E_API_ORIGIN over API_ORIGIN; it must be gone.
      expect(process.env.E2E_API_ORIGIN).toBeUndefined();
      expect(process.env.E2E_WEB_ORIGIN).toBeUndefined();
      // ...but the selector survives, so workers can re-resolve.
      expect(process.env.E2E_TARGET).toBe("staging");
      expect(process.env.NOT_A_TARGET_VARIABLE).toBeUndefined();
    } finally {
      for (const key of Object.keys(process.env)) delete process.env[key];
      Object.assign(process.env, before);
    }
  });
});

describe("parseEnvFile: dotenv semantics the env files depend on", () => {
  test("skips blanks and comments, strips inline comments, unquotes, honours export", () => {
    const file = path.join(dir, ".env.staging");
    writeFileSync(
      file,
      [
        "# a comment",
        "",
        "DATABASE_URL=postgresql://u:p@host/db   # shared pooler, prepare: false",
        'REMINDER_CUTOFF_ISO="2026-09-20T00:00:00Z"',
        "export EXPORTED=yes",
        "SPACED  =  padded  ",
        "NOT_A_PAIR",
      ].join("\n"),
      "utf8",
    );

    const parsed = parseEnvFile(file);

    expect(parsed.DATABASE_URL).toBe("postgresql://u:p@host/db");
    expect(parsed.REMINDER_CUTOFF_ISO).toBe("2026-09-20T00:00:00Z");
    expect(parsed.EXPORTED).toBe("yes");
    expect(parsed.SPACED).toBe("padded");
    expect(parsed.NOT_A_PAIR).toBeUndefined();
  });
});
