import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import {
  assertNoProductionAppEnv,
  findAppEnvViolations,
  NEXT_AUTO_ENV_FILES,
  VERCEL_CREDENTIAL_KEYS,
} from "./app-env";
import { WEB_SERVER, webServers } from "./servers";
import { E2ETargetError, PRODUCTION_MARKERS, repoRoot, resolveTarget, targetEnv } from "./target";

/**
 * #71: `apps/web/.env.local` held `VERCEL_OIDC_TOKEN`, a production deployment
 * credential. Next loads that file in dev, build, and start, so it reached the
 * e2e web process no matter what environment the process was spawned with.
 *
 * The last two tests in this file are the ones that matter most: one asserts
 * the real `apps/web` is clean, the other boots a real process with the real
 * child environment and reads its `process.env`. The first fails if the file
 * comes back, the second fails if a future change reintroduces the leak by some
 * other route.
 */

/** The real application directory, as `next build` / `next start` see it. */
const REAL_APP_DIR = path.join(repoRoot, "apps/web");

/** Real production identifiers, with fake credentials. */
const PROD_SUPABASE_URL = "https://bhtfkuzsdxrdmvvcczse.supabase.co";
const PROD_WEB_ORIGIN = "https://deadline-radar-web.vercel.app";
const NON_PROD_SUPABASE_URL = "https://notprod1234567890ab.supabase.co";

/** Distinctive enough that finding it in a message is unambiguous. */
const FAKE_OIDC_TOKEN = "oidc-token-value-that-must-never-be-echoed";

let dir: string;

function writeEnv(name: string, entries: Record<string, string>): void {
  const body = Object.entries(entries)
    .map(([key, value]) => `${key}=${value}`)
    .join("\n");
  writeFileSync(path.join(dir, name), `${body}\n`, "utf8");
}

/** A target resolved from a temp root, so no real staging env file is needed. */
function resolveStagingTarget() {
  writeEnv(".env.staging", {
    DATABASE_URL: "postgresql://postgres.notprod1234567890ab:x@db.notprod1234567890ab.supabase.co:5432/postgres",
    SUPABASE_URL: NON_PROD_SUPABASE_URL,
    SUPABASE_ANON_KEY: "anon-not-a-real-key",
    SUPABASE_SERVICE_ROLE_KEY: "service-not-a-real-key",
    AUTH_BRIDGE_SECRET: "bridge-not-a-real-secret",
    CRON_SECRET: "cron-not-a-real-secret",
    WEB_ORIGIN: "http://127.0.0.1:3025",
    API_ORIGIN: "http://127.0.0.1:4025",
  });
  return resolveTarget({ env: { E2E_TARGET: "staging" }, root: dir });
}

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), "e2e-app-env-"));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("findAppEnvViolations: a Vercel credential in the app dir is a finding", () => {
  test("reports the file and the key, and never the value", () => {
    writeEnv(".env.local", { VERCEL_OIDC_TOKEN: FAKE_OIDC_TOKEN });

    const violations = findAppEnvViolations(dir);

    expect(violations).toHaveLength(1);
    expect(violations[0]?.file).toBe(path.join(dir, ".env.local"));
    expect(violations[0]?.key).toBe("VERCEL_OIDC_TOKEN");
    expect(violations[0]?.reason).toBe("credential");
    // The token must not travel back through the finding either.
    expect(JSON.stringify(violations)).not.toContain(FAKE_OIDC_TOKEN);
  });

  test.each([...VERCEL_CREDENTIAL_KEYS])("refuses %s", (key) => {
    writeEnv(".env.local", { [key]: FAKE_OIDC_TOKEN });

    const violations = findAppEnvViolations(dir);

    expect(violations.map((violation) => violation.key)).toEqual([key]);
  });

  test("does not refuse Vercel identifiers, which grant nothing", () => {
    // Vercel injects these into every build; refusing them would make the
    // guard indistinguishable from noise.
    writeEnv(".env.local", {
      VERCEL_PROJECT_ID: "prj_notarealprojectid000",
      VERCEL_ORG_ID: "team_notarealorgid0000",
    });

    expect(findAppEnvViolations(dir)).toEqual([]);
  });

  test.each([
    ["production Supabase", { SUPABASE_URL: PROD_SUPABASE_URL }, "bhtfkuzsdxrdmvvcczse"],
    ["production web origin", { WEB_ORIGIN: PROD_WEB_ORIGIN }, "deadline-radar-web.vercel.app"],
  ])("reports a %s reference with the marker that matched", (_label, entries, marker) => {
    writeEnv(".env.local", entries);

    const violations = findAppEnvViolations(dir);

    expect(violations).toHaveLength(1);
    expect(violations[0]?.reason).toBe("production-marker");
    expect(violations[0]?.marker).toBe(marker);
  });

  test("reports every offending key, not just the first", () => {
    writeEnv(".env.local", {
      VERCEL_OIDC_TOKEN: FAKE_OIDC_TOKEN,
      NEXT_PUBLIC_SUPABASE_URL: PROD_SUPABASE_URL,
      API_ORIGIN: PROD_WEB_ORIGIN,
    });

    const keys = findAppEnvViolations(dir)
      .map((violation) => violation.key)
      .sort();

    expect(keys).toEqual(["API_ORIGIN", "NEXT_PUBLIC_SUPABASE_URL", "VERCEL_OIDC_TOKEN"]);
  });

  test("stays quiet on a clean app directory", () => {
    writeEnv(".env.local", {
      NEXT_PUBLIC_SUPABASE_URL: NON_PROD_SUPABASE_URL,
      API_ORIGIN: "http://127.0.0.1:4025",
      SOME_LOCAL_FLAG: "1",
    });

    expect(findAppEnvViolations(dir)).toEqual([]);
  });
});

describe("findAppEnvViolations: every file Next auto-loads is covered", () => {
  // A guard that only reads `.env.local` is one rename away from being useless.
  test.each([...NEXT_AUTO_ENV_FILES])("%s is scanned", (name) => {
    writeEnv(name, { VERCEL_OIDC_TOKEN: FAKE_OIDC_TOKEN });

    expect(findAppEnvViolations(dir).map((violation) => violation.key)).toEqual([
      "VERCEL_OIDC_TOKEN",
    ]);
  });

  test("the list is the union of both Next modes, development included", () => {
    // `next dev` reads the .env.development* set, everything else the
    // .env.production* set; the guard must not depend on the mode.
    expect(NEXT_AUTO_ENV_FILES).toContain(".env.development");
    expect(NEXT_AUTO_ENV_FILES).toContain(".env.development.local");
    expect(NEXT_AUTO_ENV_FILES).toContain(".env.production");
    expect(NEXT_AUTO_ENV_FILES).toContain(".env.production.local");
  });
});

describe("assertNoProductionAppEnv: the refusal an operator can act on", () => {
  test("names the file, the key, and where the value belongs", () => {
    writeEnv(".env.local", { VERCEL_OIDC_TOKEN: FAKE_OIDC_TOKEN });

    let message = "";
    try {
      assertNoProductionAppEnv(dir);
    } catch (error) {
      expect(error).toBeInstanceOf(E2ETargetError);
      message = (error as Error).message;
    }

    expect(message).toContain(".env.local");
    expect(message).toContain("VERCEL_OIDC_TOKEN");
    expect(message).toContain("loadEnvConfig");
    // The remedy has to be in the message, not just in the changelog.
    expect(message).toContain("vercel login");
  });

  test("never echoes the value it refused", () => {
    writeEnv(".env.local", { VERCEL_OIDC_TOKEN: FAKE_OIDC_TOKEN });

    let message = "";
    try {
      assertNoProductionAppEnv(dir);
    } catch (error) {
      message = (error as Error).message;
    }

    // A refusal that prints the secret puts it in CI logs and scrollback.
    expect(message).not.toContain(FAKE_OIDC_TOKEN);
  });

  test("passes on a clean directory", () => {
    writeEnv(".env.local", { NEXT_PUBLIC_SUPABASE_URL: NON_PROD_SUPABASE_URL });

    expect(() => assertNoProductionAppEnv(dir)).not.toThrow();
  });

  test("defaults to the real app directory", () => {
    // Callers pass nothing, so the default is what has to be right.
    expect(() => assertNoProductionAppEnv()).not.toThrow();
  });
});

describe("the real app directory", () => {
  test("holds no production credential and no production reference", () => {
    // #71: this failed while `apps/web/.env.local` still held
    // VERCEL_OIDC_TOKEN. If it fails, the file is back.
    const violations = findAppEnvViolations(REAL_APP_DIR);

    expect(
      violations.map((violation) => `${path.basename(violation.file)} ${violation.key}`),
    ).toEqual([]);
  });

  test("a real child process inherits no production credential", async () => {
    // The end-to-end shape of the leak: take the environment the suite actually
    // spawns the web child with, run a real process in the real app directory,
    // and read what ended up in its `process.env`. A sanitised env is not
    // enough, because Next and Bun both re-read the app directory's own files.
    const target = resolveStagingTarget();
    const webServer = webServers(target)[WEB_SERVER]!;

    expect(webServer.cwd).toBe(REAL_APP_DIR);

    const child = Bun.spawn({
      cmd: ["bun", "-e", "console.log(JSON.stringify(process.env))"],
      cwd: webServer.cwd,
      env: { ...targetEnv(target), ...webServer.env },
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr] = await Promise.all([
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
    ]);
    const exitCode = await child.exited;

    expect(exitCode).toBe(0);
    expect(stderr).toBe("");

    const inherited = JSON.parse(stdout) as Record<string, string>;
    // Assert on the key names only. Comparing the values would make a failure
    // print the very credential this suite exists to keep out of a process —
    // into CI logs and terminal scrollback.
    const leakedKeys = VERCEL_CREDENTIAL_KEYS.filter((key) => inherited[key] !== undefined);
    expect(leakedKeys).toEqual([]);
    // The target's own values did travel, so the probe is not vacuous.
    expect(inherited.SUPABASE_URL).toBe(NON_PROD_SUPABASE_URL);
    expect(inherited.API_ORIGIN).toBe("http://127.0.0.1:4025");

    // Same reason: report which marker matched, never the environment itself.
    const dumped = JSON.stringify(inherited);
    const markersFound = PRODUCTION_MARKERS.filter((marker) => dumped.includes(marker));
    expect(markersFound).toEqual([]);
  });
});
