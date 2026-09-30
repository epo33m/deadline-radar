import { describe, expect, test } from "bun:test";

import {
  assertNoProductionEnv,
  assertRefsMatch,
  describeDbHost,
  findProductionRefs,
  getDatabaseUrl,
  parseEnvFile,
  projectRef,
  requireEnv,
  ScriptTargetError,
} from "./target";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

/**
 * #63: no default path from local tooling to production. Every refusal below
 * names the missing variable, the offending key, or the file — never a value.
 */

const PROD_DB_URL =
  "postgresql://postgres.bhtfkuzsdxrdmvvcczse:not-a-real-password@aws-0-us-east-1.pooler.supabase.com:6543/postgres";
const PROD_SUPABASE_URL = "https://bhtfkuzsdxrdmvvcczse.supabase.co";
const STAGING_DB_URL =
  "postgresql://postgres.abcdefghijklmnopqrst:not-a-real-password@db.abcdefghijklmnopqrst.supabase.co:5432/postgres";
const STAGING_SUPABASE_URL = "https://abcdefghijklmnopqrst.supabase.co";

function expectRefusal(fn: () => void): string {
  try {
    fn();
  } catch (error) {
    expect(error).toBeInstanceOf(ScriptTargetError);
    return (error as Error).message;
  }
  throw new Error("expected ScriptTargetError, but nothing was thrown");
}

describe("findProductionRefs", () => {
  test("flags production keys and ignores clean ones", () => {
    const found = findProductionRefs({
      DATABASE_URL: PROD_DB_URL,
      SUPABASE_URL: STAGING_SUPABASE_URL,
    });
    expect(found).toEqual([["DATABASE_URL", "bhtfkuzsdxrdmvvcczse"]]);
  });

  test("empty when nothing points at production", () => {
    expect(findProductionRefs({ DATABASE_URL: STAGING_DB_URL })).toEqual([]);
    expect(findProductionRefs({})).toEqual([]);
  });
});

describe("assertNoProductionEnv", () => {
  test("passes for a clean environment", () => {
    expect(() =>
      assertNoProductionEnv({ DATABASE_URL: STAGING_DB_URL }, { context: "test" }),
    ).not.toThrow();
  });

  test("refuses production and never prints the value", () => {
    const message = expectRefusal(() =>
      assertNoProductionEnv(
        { DATABASE_URL: PROD_DB_URL, SUPABASE_URL: PROD_SUPABASE_URL },
        { context: "this database command" },
      ),
    );
    expect(message).toContain("DATABASE_URL");
    expect(message).toContain("SUPABASE_URL");
    expect(message).toContain("--allow-production");
    expect(message).not.toContain(PROD_DB_URL);
    expect(message).not.toContain("not-a-real-password");
  });

  test("an explicit --allow-production opt-in is honoured", () => {
    expect(() =>
      assertNoProductionEnv({ DATABASE_URL: PROD_DB_URL }, { allowProduction: true }),
    ).not.toThrow();
  });

  test("a custom productionHint replaces the default escape-hatch line", () => {
    const message = expectRefusal(() =>
      assertNoProductionEnv(
        { DATABASE_URL: PROD_DB_URL },
        { context: "seed-staging", productionHint: "staging-only: no escape hatch." },
      ),
    );
    expect(message).toContain("staging-only: no escape hatch.");
    expect(message).not.toContain("--allow-production");
  });
});

describe("requireEnv", () => {
  test("returns the value when set", () => {
    expect(requireEnv("SUPABASE_URL", { SUPABASE_URL: "x" })).toBe("x");
  });

  test("fails closed naming the missing variable", () => {
    const message = expectRefusal(() => requireEnv("SUPABASE_URL", {}));
    expect(message).toContain("SUPABASE_URL");
  });
});

describe("projectRef / assertRefsMatch (generalised staging guard)", () => {
  test("extracts refs from pooler, direct, and dashboard shapes", () => {
    expect(projectRef("postgresql://postgres.bhtfkuzsdxrdmvvcczse:x@host:6543/postgres")).toBe(
      "bhtfkuzsdxrdmvvcczse",
    );
    expect(projectRef("postgresql://postgres:x@db.abcdefghijklmnopqrst.supabase.co:5432/postgres")).toBe(
      "abcdefghijklmnopqrst",
    );
    expect(projectRef("https://abcdefghijklmnopqrst.supabase.co")).toBe("abcdefghijklmnopqrst");
    expect(projectRef("http://127.0.0.1:4025")).toBeNull();
  });

  test("passes when both refs match or either is absent", () => {
    expect(() =>
      assertRefsMatch({ DATABASE_URL: STAGING_DB_URL, SUPABASE_URL: STAGING_SUPABASE_URL }),
    ).not.toThrow();
    expect(() => assertRefsMatch({ DATABASE_URL: STAGING_DB_URL })).not.toThrow();
    expect(() => assertRefsMatch({})).not.toThrow();
  });

  test("refuses a mixed env file, naming the refs but not the values", () => {
    const message = expectRefusal(() =>
      assertRefsMatch(
        { DATABASE_URL: PROD_DB_URL, SUPABASE_URL: STAGING_SUPABASE_URL },
        ".env.staging",
      ),
    );
    expect(message).toContain("bhtfkuzsdxrdmvvcczse");
    expect(message).toContain("abcdefghijklmnopqrst");
    expect(message).toContain(".env.staging");
    expect(message).not.toContain(PROD_DB_URL);
  });
});

describe("getDatabaseUrl", () => {
  test("fails closed when no URL is set and names the variable", () => {
    const message = expectRefusal(() => getDatabaseUrl({}));
    expect(message).toContain("DATABASE_URL");
  });

  test("refuses production by default without printing it", () => {
    const message = expectRefusal(() => getDatabaseUrl({ DATABASE_URL: PROD_DB_URL }));
    expect(message).toContain("production");
    expect(message).not.toContain(PROD_DB_URL);
  });

  test("returns staging URLs verbatim (sslmode untouched for remote hosts)", () => {
    expect(getDatabaseUrl({ DATABASE_URL: STAGING_DB_URL })).toBe(STAGING_DB_URL);
  });

  test("adds sslmode=disable for local postgres without one", () => {
    expect(getDatabaseUrl({ DATABASE_URL: "postgresql://postgres:pw@127.0.0.1:5432/postgres" })).toBe(
      "postgresql://postgres:pw@127.0.0.1:5432/postgres?sslmode=disable",
    );
  });
});

describe("parseEnvFile", () => {
  test("parses dotenv lines, comments, and quoted values", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "script-target-"));
    try {
      const file = path.join(dir, ".env.staging");
      writeFileSync(
        file,
        ['# comment', "PLAIN=abc", "HASHED=abc # trailing", 'QUOTED="a # b"', "", "export X=y\n"].join("\n"),
        "utf8",
      );
      expect(parseEnvFile(file)).toEqual({ PLAIN: "abc", HASHED: "abc", QUOTED: "a # b", X: "y" });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("describeDbHost", () => {
  test("reports the host only, never credentials", () => {
    expect(describeDbHost({ SUPABASE_URL: STAGING_SUPABASE_URL })).toBe(
      "abcdefghijklmnopqrst.supabase.co",
    );
    expect(describeDbHost({})).toContain("unknown");
  });
});
