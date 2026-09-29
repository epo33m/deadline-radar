/**
 * `apps/web/vercel.json` decides whether `main` deploys at all.
 *
 * Getting `git.deploymentEnabled` wrong is silent: the branch merges, CI goes
 * green, and there is simply no new deployment. Nothing else in this repo
 * would notice, and the only symptom is that production is still serving the
 * previous build days later. These tests make that failure loud.
 *
 * Read from disk rather than imported so a malformed file fails here with a
 * useful message instead of at Vercel.
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const pkg = JSON.parse(readFileSync(path.join(here, "package.json"), "utf8")) as {
  scripts: Record<string, string>;
};

function readVercelConfig(): {
  buildCommand?: string;
  git?: { deploymentEnabled?: Record<string, boolean> };
} {
  const raw = readFileSync(path.join(here, "vercel.json"), "utf8");
  try {
    return JSON.parse(raw);
  } catch (error) {
    throw new Error(`apps/web/vercel.json is not valid JSON: ${(error as Error).message}`);
  }
}

describe("vercel.json: production keeps deploying", () => {
  test("main is explicitly enabled", () => {
    // The one line whose absence would stop production. Asserted directly and
    // first, because every other assertion in this file is worthless without it.
    const { git } = readVercelConfig();

    expect(git?.deploymentEnabled).toBeDefined();
    expect(git?.deploymentEnabled?.main).toBe(true);
  });

  test("buildCommand is the repo's own build script", () => {
    // Vercel's buildCommand overrides the Project Settings value. Anchoring it
    // to package.json means the deployed build cannot silently drift from the
    // build that is tested locally.
    const { buildCommand } = readVercelConfig();

    expect(buildCommand).toBeDefined();
    expect(buildCommand).toBe(pkg.scripts.build);
  });
});

describe("vercel.json: previews outside main are off", () => {
  test("every documented branch namespace is denied", () => {
    const { git } = readVercelConfig();
    const enabled = git?.deploymentEnabled ?? {};

    for (const pattern of ["dev", "feature/*", "fix/*", "improvement/*"]) {
      expect(enabled[pattern], `${pattern} must be explicitly false`).toBe(false);
    }
  });

  test("there is a catch-all deny, so an unlisted branch is covered too", () => {
    // The named patterns above follow docs/BRANCHING.md. A namespace added later
    // ("hotfix/*", say) matches none of them; the catch-all is what stops that
    // branch from silently deploying and commenting on every push.
    const { git } = readVercelConfig();
    const enabled = git?.deploymentEnabled ?? {};
    const allows = Object.entries(enabled).filter(([, value]) => value === true);

    expect(allows).toEqual([["main", true]]);
  });
});
