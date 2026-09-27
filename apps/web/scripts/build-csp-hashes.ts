#!/usr/bin/env bun
/**
 * build-csp-hashes.ts — derive static-page CSP hashes from prerendered HTML.
 *
 * Step 2 of the double-build (`bun run build`):
 *   1. `next build` prerenders the allowlisted pages (force-dynamic removed).
 *   2. This script hashes every inline <script>/<style> block in their HTML
 *      and writes `lib/csp-hashes.ts`.
 *   3. `next build` runs again so the middleware bundle embeds the fresh map.
 *   4. This script runs with `--verify`: recompute from the final output and
 *      FAIL the build on any drift (a stale map would block page scripts).
 *
 * Why double-build: the inline flight payload embeds the build ID, so hashes
 * are only valid for the build that produced them. `generateBuildId` in
 * next.config.ts is deterministic (git SHA), keeping both builds byte-
 * identical — and `--verify` proves it instead of assuming it.
 *
 * Usage:
 *   bun scripts/build-csp-hashes.ts            # generate
 *   bun scripts/build-csp-hashes.ts --verify   # recompute + compare, exit 1 on drift
 */
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

const WEB_ROOT = join(import.meta.dir, "..");
const SERVER_APP = join(WEB_ROOT, ".next", "server", "app");
const OUT_FILE = join(WEB_ROOT, "lib", "csp-hashes.ts");

/** Pathname → prerendered HTML file (flat Turbopack output, verified). */
const STATIC_ROUTES: Record<string, string> = {
  "/": "index.html",
  "/login": "login.html",
  "/register": "register.html",
  "/forgot-password": "forgot-password.html",
};

export type StaticCspHashes = {
  scripts: string[];
  styles: string[];
};

function sha256Base64(content: string): string {
  return `'sha256-${createHash("sha256").update(content, "utf8").digest("base64")}'`;
}

/** Extract inline (src-less) <script>/<style> bodies from HTML. Exported for tests. */
export function extractInlineBlocks(
  html: string,
  tag: "script" | "style",
): string[] {
  // Matches <script ...>…</script> only when no src attribute is present.
  // Scripts are emitted by Next without attributes or with async/defer, so a
  // src check on the opening tag is sufficient.
  const re =
    tag === "script"
      ? /<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g
      : /<style(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/style>/g;
  const out: string[] = [];
  let match: RegExpExecArray | null;
  while ((match = re.exec(html)) !== null) {
    out.push(match[1]);
  }
  return out;
}

function computeHashes(): Record<string, StaticCspHashes> {
  const result: Record<string, StaticCspHashes> = {};
  for (const [pathname, file] of Object.entries(STATIC_ROUTES)) {
    const path = join(SERVER_APP, file);
    if (!existsSync(path)) {
      throw new Error(
        `[csp-hashes] missing prerender ${file} for ${pathname} — ` +
          `the page is not static. Refusing to emit a partial map.`,
      );
    }
    const html = readFileSync(path, "utf8");
    const scripts = extractInlineBlocks(html, "script").map(sha256Base64);
    const styles = extractInlineBlocks(html, "style").map(sha256Base64);
    if (scripts.length === 0) {
      throw new Error(
        `[csp-hashes] no inline scripts found in ${file} — unexpected Next output, refusing to guess.`,
      );
    }
    result[pathname] = { scripts, styles };
  }
  return result;
}

function renderModule(hashes: Record<string, StaticCspHashes>): string {
  const body = Object.entries(hashes)
    .map(
      ([pathname, h]) =>
        `  ${JSON.stringify(pathname)}: {\n` +
        `    scripts: [${h.scripts.map((s) => JSON.stringify(s)).join(", ")}],\n` +
        `    styles: [${h.styles.map((s) => JSON.stringify(s)).join(", ")}],\n` +
        `  },`,
    )
    .join("\n");
  return `/**
 * Static-page CSP hashes (SEC-002, hash variant).
 *
 * GENERATED FILE — do not edit by hand. Produced by
 * \`apps/web/scripts/build-csp-hashes.ts\` during \`bun run build\`
 * (double-build: build → hash → build → verify).
 *
 * Maps a prerendered-static pathname to the SHA-256 hashes of its inline
 * \`<script>\` / \`<style>\` blocks. \`proxy.ts\` serves these pathnames with a
 * hash-based CSP (no per-request nonce, no \`x-nonce\`), which keeps the
 * pages static and edge-cacheable without weakening the policy:
 * hashes are as strong as nonces for content that is byte-identical on
 * every serve — exactly what a prerendered page is.
 *
 * An EMPTY map is the safe fallback: \`proxy.ts\` treats a pathname with no
 * entry as dynamic and uses the nonce path. A stale map would break page
 * scripts, so the build \`--verify\` step fails the build on any drift
 * instead of deploying it.
 */

export type StaticCspHashes = {
  scripts: string[];
  styles: string[];
};

/** Pathname → hashes. Empty until the build generator fills it. */
export const STATIC_CSP_HASHES: Record<string, StaticCspHashes> = {
${body}
};
`;
}

const verify = process.argv.includes("--verify");

// Guarded so unit tests can import the pure helpers without regenerating
// the map as a side effect.
if (import.meta.main) {
  if (verify) {
    const expected = renderModule(computeHashes());
    const actual = readFileSync(OUT_FILE, "utf8");
    if (expected !== actual) {
      console.error(
        "[csp-hashes] VERIFY FAILED — prerender drifted between builds.\n" +
          "The middleware would ship stale hashes and browsers would block page scripts.\n" +
          "Investigate non-deterministic prerender output before deploying.",
      );
      process.exit(1);
    }
    console.log("[csp-hashes] verify ok — no drift between builds.");
  } else {
    const hashes = computeHashes();
    mkdirSync(dirname(OUT_FILE), { recursive: true });
    writeFileSync(OUT_FILE, renderModule(hashes));
    const blocks = Object.values(hashes).reduce(
      (n, h) => n + h.scripts.length + h.styles.length,
      0,
    );
    console.log(
      `[csp-hashes] wrote ${OUT_FILE} — ${Object.keys(hashes).length} pages, ${blocks} hashed blocks.`,
    );
  }
}
