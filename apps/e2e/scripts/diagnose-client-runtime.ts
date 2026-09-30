/**
 * Client-runtime diagnostic for #58.
 *
 * The failure: the web app serves SSR HTML, but no client runtime attaches — no
 * React tree, no RSC payload consumption, no interactivity. This script decides
 * whether that is true, and if so, records the evidence the ticket asks for:
 * which required bundle executes, in what order, and where the sequence stops.
 *
 * The verdict is behavioural, not introspective. `__reactFiber`, `__next_f`, and
 * `window.next` are *recorded* as supporting evidence but never asserted on:
 * their absence is the symptom under investigation, so asserting on it would
 * be circular. The assertions are the things a user would notice — does the
 * password toggle work, does client-side navigation work.
 *
 * Usage (server must already be listening):
 *   cd apps/e2e && bun scripts/diagnose-client-runtime.ts \
 *     --browser chromium --url http://127.0.0.1:3025/login --label dev-chromium
 *
 * Writes a JSON evidence bundle to $DIAG_OUT_DIR (default /tmp/dr58/evidence)
 * and prints a summary, and exits non-zero when the client runtime is dead, so
 * it doubles as the regression loop for #59.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

import { chromium, webkit, type Browser, type ConsoleMessage, type Page } from "@playwright/test";

const OUT_DIR = process.env.DIAG_OUT_DIR ?? "/tmp/dr58/evidence";

type Options = {
  browser: "chromium" | "webkit";
  url: string;
  label: string;
  headed: boolean;
};

function parseArgs(argv: string[]): Options {
  const options: Options = {
    browser: "chromium",
    url: "http://127.0.0.1:3025/login",
    label: "run",
    headed: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--browser") options.browser = argv[++i] as Options["browser"];
    else if (arg === "--url") options.url = argv[++i] as string;
    else if (arg === "--label") options.label = argv[++i] as string;
    else if (arg === "--headed") options.headed = true;
  }
  return options;
}

type TimelineEntry = {
  at: number;
  kind: "console" | "pageerror" | "response" | "requestfailed" | "note";
  detail: string;
  url?: string;
  status?: number;
};

const t0 = Date.now();

function line(kind: TimelineEntry["kind"], detail: string, extra: Partial<TimelineEntry> = {}) {
  return { at: Date.now() - t0, kind, detail, ...extra };
}

/**
 * The behavioural probe. Both checks are things a user would notice, and both
 * fail under the #58 defect. Returns observations rather than throwing so the
 * evidence bundle is written even on failure.
 */
async function probe(page: Page) {
  const observations: Record<string, unknown> = {};

  // 1. Password-visibility toggle. Server HTML always renders type="password";
  //    a live client runtime flips it to "text" on click.
  const password = page.locator('input[name="password"]');
  observations.passwordFieldPresent = (await password.count()) > 0;
  observations.typeBefore = await password.getAttribute("type").catch(() => null);

  const toggle = page.locator('button[aria-label="Show password"]');
  observations.togglePresent = (await toggle.count()) > 0;
  await toggle.first().click({ timeout: 10_000 }).catch(() => {});
  // Give React a tick to commit the state change.
  await page.waitForTimeout(500);
  observations.typeAfter = await password.getAttribute("type").catch(() => null);
  observations.toggleWorks = observations.typeBefore === "password" && observations.typeAfter === "text";

  // 2. Client-side navigation. A <Link> click handled by the app router changes
  //    the URL without a document load; a dead runtime falls back to a full page
  //    load (or does nothing at all).
  const link = page.getByRole("link", { name: /create an account/i }).first();
  let navigations = 0;
  page.on("framenavigated", (frame) => {
    if (frame === page.mainFrame()) navigations += 1;
  });
  observations.navLinkPresent = (await link.count()) > 0;
  await link.click({ timeout: 10_000 }).catch(() => {});
  await page.waitForTimeout(1500);
  observations.pathnameAfter = new URL(page.url()).pathname;
  // One main-frame navigation is the initial load. A client-side push does not
  // add a second one.
  observations.mainFrameNavigations = navigations;
  observations.clientNavigationWorks = navigations <= 1 && observations.pathnameAfter === "/register";

  return observations;
}

/**
 * Introspection snapshot — evidence only, never an assertion.
 *
 * The DOM is reached through narrow structural types rather than the `dom` lib,
 * which this project does not enable (see tsconfig.json `types: ["bun"]`).
 */
async function snapshot(page: Page) {
  type MiniElement = Record<string, unknown>;
  type MiniDocument = {
    querySelector(selector: string): MiniElement | null;
    querySelectorAll(selector: string): { length: number };
  };
  type MiniGlobal = {
    document: MiniDocument;
    __next_f?: unknown[];
    next?: { version?: string };
  };

  return page.evaluate(() => {
    const g = globalThis as unknown as MiniGlobal;
    const root = g.document.querySelector("body > *");
    return {
      nextFlightLength: g.__next_f?.length ?? null,
      nextFlightDefined: "__next_f" in globalThis,
      nextVersion: g.next?.version ?? null,
      reactKeysOnRootElement: root
        ? Object.keys(root).filter((key) => key.startsWith("__react"))
        : [],
      scriptTagCount: g.document.querySelectorAll("script").length,
      scriptTagsWithoutNonce: g.document.querySelectorAll("script:not([nonce])").length,
    };
  });
}

async function run(options: Options) {
  const timeline: TimelineEntry[] = [];
  const launch = options.browser === "webkit" ? webkit : chromium;
  const browser: Browser = await launch.launch({ headless: !options.headed });

  // CDP is Chromium-only and is the only way to get true script *execution*
  // order rather than network order. WebKit falls back to resource timing.
  const scriptExecutionOrder: { url: string; scriptId: string }[] = [];

  try {
    const context = await browser.newContext();
    const page = await context.newPage();

    // Page-scoped, and attached before navigation: scriptParsed replays what
    // already ran, but ordering is only trustworthy from a fresh target.
    const cdp =
      options.browser === "chromium" ? await context.newCDPSession(page) : null;
    if (cdp) {
      cdp.on("Debugger.scriptParsed", (event) => {
        if (event.url.includes("/_next/")) {
          scriptExecutionOrder.push({ url: event.url, scriptId: event.scriptId });
        }
      });
      await cdp.send("Debugger.enable");
    }

    page.on("console", (message: ConsoleMessage) => {
      timeline.push(line("console", `[${message.type()}] ${message.text()}`, { url: page.url() }));
    });
    page.on("pageerror", (error) => {
      timeline.push(line("pageerror", `${error.name}: ${error.message}\n${error.stack ?? ""}`));
    });
    page.on("requestfailed", (request) => {
      timeline.push(
        line("requestfailed", request.failure()?.errorText ?? "unknown", { url: request.url() }),
      );
    });
    // Every response, not just /_next/: a request that was never even attempted
    // leaves no trace here, and that absence is itself evidence.
    page.on("response", (response) => {
      timeline.push(
        line("response", response.headers()["content-type"] ?? "", {
          url: response.url(),
          status: response.status(),
        }),
      );
    });

    const gotoResponse = await page.goto(options.url, {
      waitUntil: "load",
      timeout: 60_000,
    });
    timeline.push(line("note", `goto settled: ${gotoResponse?.status()}`));
    // Let hydration and any async RSC fetch finish (or fail) before probing.
    await page.waitForTimeout(3000);

    const observations = await probe(page);
    const introspection = await snapshot(page);

    // Script execution order, best available source per engine.
    if (scriptExecutionOrder.length === 0) {
      scriptExecutionOrder.push(
        ...(await page.evaluate(() =>
          performance
            .getEntriesByType("resource")
            .filter((entry) => entry.name.includes("/_next/"))
            .map((entry, index) => ({ url: entry.name, scriptId: String(index) })),
        )),
      );
    }

    const verdict = {
      label: options.label,
      browser: options.browser,
      url: options.url,
      clientRuntimeAlive: Boolean(observations.toggleWorks || observations.clientNavigationWorks),
      observations,
      introspection,
      scriptExecutionOrder,
      timeline,
    };

    mkdirSync(OUT_DIR, { recursive: true });
    const file = path.join(OUT_DIR, `${options.label}.json`);
    writeFileSync(file, JSON.stringify(verdict, null, 2));

    console.log(`\n── ${options.label} (${options.browser}) ──`);
    console.log(`  client runtime alive : ${verdict.clientRuntimeAlive}`);
    console.log(`  password toggle      : ${observations.toggleWorks} (${String(observations.typeBefore)} → ${String(observations.typeAfter)})`);
    console.log(`  client nav           : ${observations.clientNavigationWorks} (→ ${observations.pathnameAfter}, ${observations.mainFrameNavigations} main-frame navs)`);
    console.log(`  __next_f defined     : ${introspection.nextFlightDefined} (len ${String(introspection.nextFlightLength)})`);
    console.log(`  window.next.version  : ${String(introspection.nextVersion)}`);
    console.log(`  __react* keys on root: ${JSON.stringify(introspection.reactKeysOnRootElement)}`);
    console.log(`  pageerrors           : ${timeline.filter((e) => e.kind === "pageerror").length}`);
    console.log(`  console errors       : ${timeline.filter((e) => e.kind === "console" && e.detail.startsWith("[error]")).length}`);
    console.log(`  evidence             : ${file}\n`);

    await context.close();
    return verdict.clientRuntimeAlive ? 0 : 1;
  } finally {
    await browser.close();
  }
}

const options = parseArgs(process.argv.slice(2));
process.exit(await run(options));
