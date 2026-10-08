/**
 * #155: the web suite runs with `bun test --isolate`, and this file is what keeps
 * that honest.
 *
 * The failure it prevents: `proxy.test.ts` imports
 * `next/experimental/testing/server` to evaluate the proxy `matcher`. That
 * import reaches Next's server `node-environment`, which patches 13 console
 * methods at import time (`console-dim.external.js`) with wrappers that consult
 * `AsyncLocalStorage`. bun has no global `AsyncLocalStorage`, so Next
 * substitutes `FakeAsyncLocalStorage`, whose `run`/`exit`/`enterWith` throw
 * `E504` — "Invariant: AsyncLocalStorage accessed in runtime where it is not
 * available". Every `console.*` call in that file then throws.
 *
 * On one shared global (bun's default) that patch leaked into every test file
 * loaded afterwards, and the damage surfaced as an unrelated-looking error in
 * whichever test happened to be running next. `--isolate` gives each test file a
 * fresh global, so the patch stays confined to `proxy.test.ts` — which never
 * logs.
 *
 * Note that isolation cannot help the importing file itself: any test that
 * imports Next's server runtime directly still gets a poisoned console, which
 * is why the second case below pins the blast radius instead.
 */
import { describe, expect, test } from "bun:test";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));

/**
 * Test files allowed to import a real Next module. Everything Next-related
 * elsewhere in the suite is `mock.module`-stubbed, so this list is the complete
 * set of files whose console can be poisoned.
 */
const ALLOWED_NEXT_IMPORTS: Record<string, string> = {
  // Evaluates the proxy `matcher`; deliberately imports no Next runtime.
  "proxy.test.ts": "next/experimental/testing/server",
};

function collect(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry === ".next") continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      out.push(...collect(full));
    } else if (entry.endsWith(".test.ts") || entry.endsWith(".test.tsx")) {
      out.push(full);
    }
  }
  return out;
}

describe("#155 — test isolation keeps Next's console patch contained", () => {
  test("the web test script runs each file in its own global", () => {
    const pkg = JSON.parse(
      readFileSync(join(here, "package.json"), "utf8"),
    ) as { scripts: Record<string, string> };
    const script = pkg.scripts.test ?? "";

    // `--isolate` is the fix, not a preference: dropping it lets one file's
    // import-time side effect decide whether every later file can log.
    expect(script).toContain("bun test --isolate");
  });

  test("only the declared test file imports a real Next module", () => {
    // Each offender is reported with the guidance inline, because bun's
    // `expect` takes no message argument — the failure output is the value.
    const offenders: string[] = [];
    for (const file of collect(here)) {
      const relative = file.slice(here.length + 1);
      // This file names `next/…` only in its own prose, so it would match the
      // scan below; it imports no Next module.
      if (relative === "console-guard.test.ts") continue;
      const source = readFileSync(file, "utf8");
      // `mock.module("next/…")` replaces the module and never loads it, so only
      // a static `from "next/…"` import can pull Next's runtime in.
      if (!/from\s+["']next\//.test(source)) continue;
      const declared = ALLOWED_NEXT_IMPORTS[relative];
      if (!declared) {
        offenders.push(
          `${relative} — its console is poisoned; add it to ALLOWED_NEXT_IMPORTS and keep it free of console calls`,
        );
        continue;
      }
      if (!source.includes(`from "${declared}"`)) {
        offenders.push(
          `${relative} — must import ${declared} explicitly, not a deeper path`,
        );
      }
    }

    expect(offenders).toEqual([]);
  });
});
