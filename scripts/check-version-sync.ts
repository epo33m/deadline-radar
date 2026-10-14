#!/usr/bin/env bun
/**
 * Version-sync guard (issue #145).
 *
 * Fails when workspace `package.json` versions drift from each other,
 * or — when a release tag is given — when they drift from the tag.
 *
 * Usage:
 *   bun run check:version                       # workspace consistency only
 *   bun run scripts/check-version-sync.ts --tag v1.1.0
 *   RELEASE_TAG=v1.1.0 bun run check:version    # CI / release checklist
 *
 * In CI (`ci-dev.yml`) the tag is usually not fetched, so the tag check is
 * skipped unless a tag is explicitly provided. The release checklist
 * (`docs/RELEASE.md`) requires the `--tag` form before publishing.
 */

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const rootDir = join(import.meta.dir, "..");

function readVersion(file: string): string {
  const raw = readFileSync(file, "utf8");
  const parsed = JSON.parse(raw) as { version?: unknown };
  if (typeof parsed.version !== "string" || parsed.version.length === 0) {
    throw new Error(`${file} has no string "version" field`);
  }
  return parsed.version;
}

function workspaceManifests(): string[] {
  const out: string[] = [];
  for (const dir of ["apps", "packages"]) {
    let entries: string[] = [];
    try {
      entries = readdirSync(join(rootDir, dir), { withFileTypes: true })
        .filter((e) => e.isDirectory())
        .map((e) => e.name);
    } catch {
      continue;
    }
    for (const name of entries) {
      const file = join(rootDir, dir, name, "package.json");
      try {
        readFileSync(file);
        out.push(file);
      } catch {
        // No manifest — skip.
      }
    }
  }
  return out.sort();
}

function resolveTag(): string | null {
  const tagFlag = process.argv.indexOf("--tag");
  const argvTag = process.argv.find((a) => a.startsWith("--tag="))?.slice("--tag=".length)
    ?? (tagFlag !== -1 ? process.argv[tagFlag + 1] : undefined);
  let envTag: string | undefined;
  if (process.env.RELEASE_TAG) {
    envTag = process.env.RELEASE_TAG;
  } else if (process.env.GITHUB_REF?.startsWith("refs/tags/")) {
    envTag = process.env.GITHUB_REF.replace("refs/tags/", "");
  }
  const tag = argvTag ?? envTag ?? null;
  if (!tag || tag.startsWith("--")) return null;
  return tag.startsWith("v") ? tag.slice(1) : tag;
}

const rootFile = join(rootDir, "package.json");
const rootVersion = readVersion(rootFile);
const failures: string[] = [];

for (const file of workspaceManifests()) {
  const v = readVersion(file);
  if (v !== rootVersion) {
    failures.push(`${file}: ${v} (expected ${rootVersion})`);
  }
}

const tag = resolveTag();
if (tag !== null && tag !== rootVersion) {
  failures.push(`release tag v${tag} does not match package.json version ${rootVersion}`);
}

if (failures.length > 0) {
  console.error("❌ Version drift detected:");
  for (const f of failures) console.error(`  - ${f}`);
  console.error("\nFix: bump every package.json to the release version before tagging (see docs/RELEASE.md).");
  process.exit(1);
}

console.log(`✅ Version sync OK: ${rootVersion}${tag !== null ? ` (matches tag v${tag})` : " (workspaces consistent; no tag given)"}`);
