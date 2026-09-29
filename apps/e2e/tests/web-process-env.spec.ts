/**
 * #71 — the running web process must not hold a production credential.
 *
 * Type: process introspection. No browser, no HTTP, no database.
 *
 * `app-env.test.ts` proves the same thing by scanning files and by booting a
 * throwaway process. This spec closes the loop on the real thing: it reads the
 * live `next start` process that Playwright started for this run, so a leak
 * introduced by any other route — a build step, a shell profile, a server entry
 * that reads something the other tests never touch — is caught here and not
 * only in review.
 *
 * The environment of a running process cannot be read through procfs, so this
 * reads `ps eww`, which is the only portable way to see another process's
 * environment on darwin. It is asserted by key name and by marker, never by
 * value, so a failure cannot print the credential it found.
 *
 * Serial by design (playwright.config.ts: workers: 1): the PID is found by
 * port, so the web server must be the one this run started.
 */
import { expect, test } from "@playwright/test";
import { execFileSync } from "node:child_process";

import { PRODUCTION_MARKERS, resolveTarget } from "../target";
import { VERCEL_CREDENTIAL_KEYS } from "../app-env";

/** The PID holding `port`, or null if nothing is listening. */
function pidOnPort(port: number): string | null {
  try {
    const out = execFileSync("lsof", ["-ti", `tcp:${port}`, "-sTCP:LISTEN"], {
      encoding: "utf8",
    });
    const pid = out.split("\n").find((line) => line.trim() !== "");
    return pid ? pid.trim() : null;
  } catch {
    // lsof exits non-zero when nothing matches, which is a legitimate answer.
    return null;
  }
}

/** `ps eww`: the command line with its full environment appended. */
function environmentOf(pid: string): string {
  return execFileSync("ps", ["eww", "-p", pid], { encoding: "utf8" });
}

test.describe("the live web process inherits no production credential", () => {
  test("the running next server's environment is clean", () => {
    const target = resolveTarget();

    // The web server is the second webServer entry; assert against its port so
    // this cannot pass by inspecting the API process instead.
    const pid = pidOnPort(target.webPort);
    expect(
      pid,
      `no process is listening on the web port ${target.webPort}, so there is nothing to inspect`,
    ).not.toBeNull();

    const environment = environmentOf(pid!);

    // Key names only: a failure must not print what it found.
    const leakedKeys = VERCEL_CREDENTIAL_KEYS.filter((key) => environment.includes(key));
    expect(leakedKeys, "the web process inherited a Vercel credential").toEqual([]);

    const markersFound = PRODUCTION_MARKERS.filter((marker) => environment.includes(marker));
    expect(markersFound, "the web process inherited a production identifier").toEqual([]);
  });
});
